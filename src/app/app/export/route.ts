import { NextResponse } from "next/server";
import { deflateRawSync } from "node:zlib";
import { createClient } from "@/lib/supabase/server";

const batchSize = 500;
const utf8Flag = 0x0800;

type ZipEntry = { name: string; data: Buffer };

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const timestamp = zipTimestamp(new Date());
  let localOffset = 0;

  for (const entry of entries) {
    const filename = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(filename.length, 26);
    localParts.push(localHeader, filename, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(filename.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, filename);
    localOffset += localHeader.length + filename.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function safeDocumentFilename(title: string) {
  const safeTitle = title.normalize("NFC").replace(/[\\/:*?\"<>|\u0000-\u001f]/g, "-").trim().slice(0, 80) || "Untitled";
  return safeTitle;
}

async function getAllRows<T>(loadPage: (start: number, end: number) => Promise<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let start = 0; ; start += batchSize) {
    const { data, error } = await loadPage(start, start + batchSize - 1);
    if (error) throw new Error("Could not prepare your backup.");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < batchSize) return rows;
  }
}

export async function GET(request: Request) {
  const zipRequested = new URL(request.url).searchParams.get("format") === "zip";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to download your backup." }, { status: 401 });

  const { data: workspace, error: workspaceError } = await supabase.from("workspaces")
    .select("id,name,created_at,updated_at")
    .eq("owner_id", user.id).order("created_at").limit(1).maybeSingle();
  if (workspaceError || !workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  try {
    const [documents, folders, tags, documentTags] = await Promise.all([
      getAllRows(async (start, end) => await supabase.from("documents").select("*").eq("workspace_id", workspace.id).order("id").range(start, end)),
      getAllRows(async (start, end) => await supabase.from("folders").select("*").eq("workspace_id", workspace.id).order("id").range(start, end)),
      getAllRows(async (start, end) => await supabase.from("tags").select("*").eq("workspace_id", workspace.id).order("id").range(start, end)),
      getAllRows(async (start, end) => await supabase.from("document_tags").select("*").eq("workspace_id", workspace.id).order("document_id").order("tag_id").range(start, end)),
    ]);

    const backup = {
      format: "moc-workspace-backup",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace,
      data: { documents, folders, tags, documentTags },
    };
    if (zipRequested) {
      const entries: ZipEntry[] = [
        { name: "README.txt", data: Buffer.from("Mộc workspace backup. The workspace.json file contains the complete export, including original document JSON. Files in documents/ are convenient Markdown copies. Image binaries in private storage are not included.", "utf8") },
        { name: "workspace.json", data: Buffer.from(JSON.stringify(backup, null, 2), "utf8") },
      ];
      for (const document of documents) {
        const basename = `${safeDocumentFilename(document.title)}-${document.id.slice(0, 8)}`;
        entries.push({ name: `documents/${basename}.md`, data: Buffer.from(document.content_markdown ?? "", "utf8") });
      }
      const zip = createZip(entries);
      return new NextResponse(zip, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="moc-workspace-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="moc-workspace-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not prepare your backup. Please try again." }, { status: 500 });
  }
}
