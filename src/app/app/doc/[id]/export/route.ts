import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { documentToMarkdown, type DocumentNode } from "@/features/documents/markdown";

function safeFilename(title: string) {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug || "document";
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "markdown" && format !== "json") return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to export this document." }, { status: 401 });

  const { data: document, error } = await supabase.from("documents")
    .select("id,title,content_json,content_markdown,updated_at")
    .eq("id", id).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (error || !document) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const filename = safeFilename(document.title);
  const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  if (format === "markdown") {
    const markdown = `# ${document.title}\n\n${documentToMarkdown(document.content_json as DocumentNode)}\n`;
    headers.set("Content-Type", "text/markdown; charset=utf-8");
    headers.set("Content-Disposition", `attachment; filename="${filename}.md"`);
    return new NextResponse(markdown, { headers });
  }

  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${filename}.json"`);
  return new NextResponse(JSON.stringify({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    document: { id: document.id, title: document.title, content: document.content_json, markdown: document.content_markdown, updatedAt: document.updated_at },
  }, null, 2), { headers });
}
