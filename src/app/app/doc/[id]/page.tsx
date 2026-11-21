import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Archive, ArrowLeft, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { setDocumentFlagAction, trashDocumentAction } from "@/features/documents/actions";
import { DocumentWorkspace } from "@/features/documents/document-workspace";
import { SupabaseSetupNote } from "@/components/supabase-setup-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { DocumentSharing } from "@/features/documents/sharing";
import type { DocumentShareSummary } from "@/features/documents/sharing";
import { DocumentViewer } from "@/features/documents/document-viewer";
import { getDocumentImageSummary } from "@/lib/supabase/document-assets";

type RegisteredSharedDocument = { id: string; title: string; content_json: Record<string, unknown>; updated_at: string };

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <SupabaseSetupNote/>;
  const [{ id }, { edit }] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [{ data: { user } }, { data: ownedDocument }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("documents").select("id,workspace_id,owner_id,title,content_json,folder_id,is_archived,deleted_at,updated_at").eq("id", id).maybeSingle(),
  ]);
  if (!user) redirect("/login");
  let sharedDocument: RegisteredSharedDocument | null = null;
  if (!ownedDocument) {
    const result = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: RegisteredSharedDocument[] | null; error: { message: string } | null }> }).rpc("get_registered_shared_document", { target_document: id });
    sharedDocument = result.error ? null : result.data?.[0] ?? null;
  }
  const isOwner = Boolean(ownedDocument);
  if (process.env.NODE_ENV === "development" && ownedDocument) {
    console.info("[image-audit:open]", id, getDocumentImageSummary(ownedDocument.content_json));
  }
  const document = ownedDocument ? { ...ownedDocument } : sharedDocument ? {
    ...sharedDocument, workspace_id: "", owner_id: "", folder_id: null, is_archived: false, deleted_at: null,
  } : null;
  if (!document || (isOwner && document.deleted_at)) notFound();
  const [{ data: folders }, { data: shareLinks }, shareResult, tagResult] = await Promise.all([
    isOwner ? supabase.from("folders").select("id,name").eq("workspace_id", document.workspace_id).is("deleted_at", null).order("name") : Promise.resolve({ data: null }),
    isOwner ? supabase.from("document_share_links").select("id,created_at,expires_at,revoked_at").eq("document_id", document.id).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    isOwner ? (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: DocumentShareSummary[] | null; error: { message: string } | null }> }).rpc("get_document_shares", { target_document: document.id }) : Promise.resolve({ data: null, error: null }),
    isOwner ? (async () => {
      const { data: documentTagRows, error } = await supabase.from("document_tags").select("tag_id").eq("document_id", document.id);
      if (error || !documentTagRows?.length) return { data: [] as { name: string }[] };
      return await supabase.from("tags").select("name").in("id", documentTagRows.map((row) => row.tag_id)).order("name");
    })() : Promise.resolve({ data: [] as { name: string }[] }),
  ]);
  const documentShares = shareResult.data ?? [];
  const documentTags = (tagResult.data ?? []).map((tag) => tag.name);
  const documentFolderName = folders?.find((folder) => folder.id === document.folder_id)?.name;
  const backHref = !isOwner ? "/app?view=shared" : document.folder_id ? `/app?folder=${document.folder_id}` : "/app?view=all";
  const backLabel = !isOwner ? "Shared with me" : document.folder_id ? "Back to folder" : "All documents";

  return <main className="min-h-screen bg-white">
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-8">
      <Link href={backHref} className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"><ArrowLeft size={16}/>{backLabel}</Link>
      <div className="flex items-center gap-1">{isOwner && <DocumentSharing documentId={id} links={shareLinks ?? []} shares={documentShares}/>}<ThemeToggle/>{isOwner && <><form action={setDocumentFlagAction.bind(null, id, "is_archived", !document.is_archived)}><button title={document.is_archived ? "Unarchive" : "Archive"} aria-label={document.is_archived ? "Unarchive" : "Archive"} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"><Archive size={15}/><span className="hidden sm:inline">{document.is_archived ? "Unarchive" : "Archive"}</span></button></form><form action={trashDocumentAction.bind(null, id)}><button title="Move to trash" aria-label="Move to trash" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600"><Trash2 size={15}/><span className="hidden sm:inline">Move to trash</span></button></form></>}</div>
    </header>
    {isOwner ? <DocumentWorkspace document={{ id: document.id, title: document.title, content: document.content_json as Record<string, unknown>, folderId: document.folder_id, tags: documentTags, updatedAt: document.updated_at }} folders={folders ?? []} folderName={documentFolderName} startInEditMode={edit === "1"}/> : <section className="mx-auto mt-8 max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-7 py-7 sm:px-12"><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Shared with you · Read only</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{document.title}</h1></div><div className="px-7 py-8 sm:px-12"><DocumentViewer content={document.content_json as Record<string, unknown>}/></div></section>}
  </main>;
}
