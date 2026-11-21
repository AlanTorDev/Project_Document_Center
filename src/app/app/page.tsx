import Link from "next/link";
import { redirect } from "next/navigation";
import { Archive, ChevronDown, Download, FileText, Folder, Heart, LogOut, Plus, Search, Settings, Settings2, Share2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SupabaseSetupNote } from "@/components/supabase-setup-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { DocumentSearch } from "@/components/document-search";
import { createDocumentAction, createFolderAction, setDocumentFlagAction, trashDocumentAction } from "@/features/documents/actions";
import { FolderTree, type FolderTreeNode } from "@/features/documents/folder-tree";
import { MAX_SUBFOLDER_DEPTH } from "@/features/documents/folder-constants";

type SearchParams = Promise<{ view?: string; q?: string; page?: string; folder?: string }>;
type SearchDocument = { id: string; title: string; updated_at: string; is_favorite: boolean; is_archived: boolean; folder_id: string | null; folder_name: string | null; tag_names: string[]; rank: number };
type FolderRow = { id: string; name: string; parent_id: string | null };

export default async function PrivateHomePage({ searchParams }: { searchParams: SearchParams }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <SupabaseSetupNote/>;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: workspace } = await supabase.from("workspaces").select("id,name").eq("owner_id", user.id).order("created_at").limit(1).maybeSingle();
  if (!workspace) return <main className="p-10">Your workspace is not available yet. Please sign out and sign in again.</main>;

  const { view: requestedView, q: rawQuery, page: rawPage, folder: rawFolderId } = await searchParams;
  const view = ["all", "favorites", "archive", "trash", "shared"].includes(requestedView ?? "") ? requestedView! : "all";
  const query = (rawQuery ?? "").trim().slice(0, 120);
  const page = Math.max(1, Math.min(10000, Number.parseInt(rawPage ?? "1", 10) || 1));
  const pageSize = 20;
  const folderId = !query && view === "all" && rawFolderId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawFolderId) ? rawFolderId : null;
  if (rawFolderId && !folderId && !query) redirect("/app?view=all");
  const docsQuery = supabase.from("documents").select("id,title,updated_at,is_favorite,is_archived,folder_id")
    .order("updated_at", { ascending: false }).limit(100);
  docsQuery.eq("workspace_id", workspace.id);
  if (folderId) docsQuery.eq("folder_id", folderId);
  if (view === "trash") docsQuery.not("deleted_at", "is", null);
  else {
    docsQuery.is("deleted_at", null);
    if (view === "favorites") docsQuery.eq("is_favorite", true).eq("is_archived", false);
    if (view === "archive") docsQuery.eq("is_archived", true);
  }
  const [{ data: documentRows }, { data: folders }, searchResult] = await Promise.all([
    query ? Promise.resolve({ data: null }) : view === "shared"
      ? (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: { id: string; title: string; updated_at: string; is_favorite: boolean; is_archived: boolean; folder_id: string | null }[] | null; error: { message: string } | null }> }).rpc("list_shared_documents", {})
      : docsQuery,
    supabase.from("folders").select("id,name,parent_id").eq("workspace_id", workspace.id).is("deleted_at", null).order("name"),
    query ? (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: SearchDocument[] | null; error: { message: string } | null }> }).rpc(view === "shared" ? "search_shared_documents" : "search_documents", {
      search_query: query, ...(view === "shared" ? {} : { target_workspace: workspace.id }), result_limit: pageSize + 1, result_offset: (page - 1) * pageSize,
    }) : Promise.resolve(null),
  ]);
  const documents = query ? (searchResult?.data ?? []).slice(0, pageSize) : (documentRows ?? []);
  const quickAccessDocuments = !query && view !== "trash" ? (documentRows ?? []).slice(0, 5) : [];
  const hasNextPage = query && (searchResult?.data?.length ?? 0) > pageSize;
  const searchError = searchResult?.error?.message;
  const activeFolders = (folders ?? []) as FolderRow[];
  const activeFolderIds = new Set(activeFolders.map((folder) => folder.id));
  const folderNames = new Map(activeFolders.map((folder) => [folder.id, folder.name]));
  const folderNodes = new Map(activeFolders.map((folder) => [folder.id, { ...folder, children: [] as FolderTreeNode[] }]));
  const folderRoots: FolderTreeNode[] = [];
  const folderParentIds = new Map(activeFolders.map((folder) => [folder.id, folder.parent_id && activeFolderIds.has(folder.parent_id) ? folder.parent_id : null]));
  const hasParentCycle = (folderId: string, parentId: string) => {
    const visited = new Set([folderId]);
    let current: string | null = parentId;
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      current = folderParentIds.get(current) ?? null;
    }
    return false;
  };
  for (const folder of activeFolders) {
    const node = folderNodes.get(folder.id)!;
    const parentId = folderParentIds.get(folder.id);
    const parent = parentId ? folderNodes.get(parentId) : null;
    if (parent && !hasParentCycle(folder.id, parent.id)) parent.children.push(node);
    else folderRoots.push(node);
  }
  const foldersByParent = new Map<string | null, FolderRow[]>();
  for (const folder of activeFolders) {
    const parentId = folder.parent_id && activeFolderIds.has(folder.parent_id) ? folder.parent_id : null;
    const siblings = foldersByParent.get(parentId) ?? [];
    siblings.push(folder);
    foldersByParent.set(parentId, siblings);
  }
  const folderTree: { folder: FolderRow; depth: number }[] = [];
  const visitedFolders = new Set<string>();
  const visitFolder = (folder: FolderRow, depth: number) => {
    if (visitedFolders.has(folder.id)) return;
    visitedFolders.add(folder.id);
    folderTree.push({ folder, depth });
    for (const child of foldersByParent.get(folder.id) ?? []) visitFolder(child, depth + 1);
  };
  for (const root of foldersByParent.get(null) ?? []) visitFolder(root, 0);
  for (const orphan of activeFolders) if (!visitedFolders.has(orphan.id)) visitFolder(orphan, 0);
  const selectedFolder = folderId ? (folders ?? []).find((folder) => folder.id === folderId) ?? null : null;
  if (folderId && !selectedFolder) redirect("/app?view=all");
  const folderAncestors: string[] = [];
  const folderAncestorIds: string[] = [];
  let parentId = selectedFolder?.parent_id ?? null;
  const ancestorIds = new Set<string>();
  while (parentId && !ancestorIds.has(parentId)) {
    ancestorIds.add(parentId);
    const parent = activeFolders.find((folder) => folder.id === parentId);
    if (!parent) break;
    folderAncestors.unshift(parent.name);
    folderAncestorIds.unshift(parent.id);
    parentId = parent.parent_id;
  }
  const childFolders = selectedFolder ? (foldersByParent.get(selectedFolder.id) ?? []) : [];
  const labels: Record<string, string> = { all: "All documents", favorites: "Favorites", archive: "Archive", shared: "Shared with me", trash: "Trash" };

  return <div className="min-h-screen bg-[var(--background)] text-slate-900">
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col overflow-y-auto overscroll-contain border-r border-slate-200 bg-white px-3 py-4 md:flex">
      <Link href="/app" className="mb-6 flex items-center gap-3 px-2"><span className="grid size-9 place-items-center rounded-xl bg-indigo-600 font-bold text-white">M</span><span className="font-semibold tracking-tight">mộc</span></Link>
      <div className="mb-4 rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-slate-400">Workspace</p><p className="mt-1 truncate text-sm font-medium">{workspace.name}</p></div>
      <details open className="group/sidebar-folders mt-1 shrink-0">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Folder size={15} className="text-slate-400"/>Folders<span className="font-normal text-slate-400">{folders?.length ?? 0}</span></span>
          <ChevronDown size={15} className="text-slate-400 transition-transform group-open/sidebar-folders:rotate-180"/>
        </summary>
        <FolderTree folders={folderRoots} selectedFolderId={selectedFolder?.id ?? null} initiallyExpandedIds={folderAncestorIds}/>
      </details>
      <details open={view !== "all"} className="group/sidebar-advanced mt-3 shrink-0">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Settings2 size={15} className="text-slate-400"/>Advanced</span>
          <ChevronDown size={15} className="text-slate-400 transition-transform group-open/sidebar-advanced:rotate-180"/>
        </summary>
        <nav aria-label="Advanced document views" className="mt-1 space-y-0.5">
          <Link href="/app?view=all" aria-current={view === "all" && !selectedFolder ? "page" : undefined} className={`nav-item min-h-11 ${view === "all" && !selectedFolder ? "bg-indigo-50 font-medium text-indigo-700" : ""}`}><FileText size={16}/> All documents</Link>
          <Link href="/app?view=favorites" aria-current={view === "favorites" ? "page" : undefined} className={`nav-item min-h-11 ${view === "favorites" ? "bg-indigo-50 font-medium text-indigo-700" : ""}`}><Heart size={16}/> Favorites</Link>
          <Link href="/app?view=shared" aria-current={view === "shared" ? "page" : undefined} className={`nav-item min-h-11 ${view === "shared" ? "bg-indigo-50 font-medium text-indigo-700" : ""}`}><Share2 size={16}/> Shared with me</Link>
          <Link href="/app?view=archive" aria-current={view === "archive" ? "page" : undefined} className={`nav-item min-h-11 ${view === "archive" ? "bg-indigo-50 font-medium text-indigo-700" : ""}`}><Archive size={16}/> Archive</Link>
          <Link href="/app?view=trash" aria-current={view === "trash" ? "page" : undefined} className={`nav-item min-h-11 ${view === "trash" ? "bg-indigo-50 font-medium text-indigo-700" : ""}`}><Trash2 size={16}/> Trash</Link>
        </nav>
      </details>
      {!query && view !== "trash" && <section aria-label="Quick access" className="mt-4 shrink-0 border-t border-slate-100 pt-3">
        <div className="mb-1 flex min-h-9 items-center justify-between px-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Quick access</h2>
          {view !== "shared" && <form action={createDocumentAction}>{selectedFolder && <input type="hidden" name="folder_id" value={selectedFolder.id}/>}<button aria-label="New document" title="New document" className="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><Plus size={17}/></button></form>}
        </div>
        {quickAccessDocuments.length > 0 ? <nav aria-label="Quick access documents" className="space-y-0.5">
          {quickAccessDocuments.map((document) => <Link key={document.id} href={`/app/doc/${document.id}`} title={document.title} className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-indigo-700">
            <FileText size={15} aria-hidden className="shrink-0 text-slate-400"/><span className="truncate">{document.title}</span>
          </Link>)}
        </nav> : <p className="px-2 py-2 text-xs leading-5 text-slate-400">Your documents will appear here.</p>}
      </section>}
      <details className="group/sidebar-settings mt-auto shrink-0 border-t border-slate-100 pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Settings size={15} className="text-slate-400"/>Settings</span>
          <ChevronDown size={15} className="text-slate-400 transition-transform group-open/sidebar-settings:rotate-180"/>
        </summary>
        <nav aria-label="Settings" className="mt-1 space-y-0.5">
          <a href="/app/export" className="nav-item min-h-11"><Download size={16}/> JSON backup</a>
          <a href="/app/export?format=zip" className="nav-item min-h-11"><Archive size={16}/> ZIP backup</a>
          <form action="/auth/signout" method="post"><button className="nav-item min-h-11 w-full text-left"><LogOut size={16}/> Sign out</button></form>
        </nav>
      </details>
    </aside>
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:ml-64 md:px-8 md:py-8 xl:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">{workspace.name}{selectedFolder ? <><span className="mx-2">/</span>{[...folderAncestors, selectedFolder.name].join(" / ")}</> : null}</p><h1 className="mt-1.5 text-2xl font-semibold tracking-tight md:text-3xl">{selectedFolder?.name ?? labels[view]}</h1><p className="mt-1.5 text-sm text-slate-500">A private place for your notes and knowledge.</p></div>
        <div className="flex items-center gap-3"><ThemeToggle/>{view !== "trash" && <form action={createDocumentAction}>{selectedFolder && <input type="hidden" name="folder_id" value={selectedFolder.id}/>}<button className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"><Plus size={17}/> New document</button></form>}</div>
      </div>
      <DocumentSearch key={query} query={query}/>
      {!query && <div className="mt-6 flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-3">
        {Object.entries(labels).map(([key, label]) => <Link key={key} href={`/app?view=${key}`} className={`rounded-lg px-3 py-1.5 text-sm ${view === key ? "bg-white font-medium text-indigo-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:bg-white"}`}>{label}</Link>)}
      </div>}
      {!query && view !== "trash" && view !== "shared" && (selectedFolder && folderAncestors.length >= MAX_SUBFOLDER_DEPTH ? <p className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Maximum subfolder depth ({MAX_SUBFOLDER_DEPTH}) reached.</p> : <details className="group mt-5 rounded-xl border border-dashed border-slate-300 bg-white/70 p-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-600"><Plus size={16}/> {selectedFolder ? "Create subfolder" : "Create a folder"}</summary><form action={createFolderAction} className="mt-3 flex max-w-lg gap-2">{selectedFolder && <input type="hidden" name="parent_id" value={selectedFolder.id}/>}<input name="name" required maxLength={120} placeholder={selectedFolder ? `Folder inside ${selectedFolder.name}` : "Folder name"} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"/><button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Create folder</button></form>
        {(folders?.length ?? 0) > 0 && <div className="mt-4 flex flex-wrap gap-2">{folderTree.map(({ folder, depth }) => <Link key={folder.id} href={`/app?folder=${folder.id}`} title={folder.name} style={{ paddingLeft: `${8 + depth * 8}px` }} className="inline-flex items-center gap-2 rounded-lg bg-slate-50 py-2 pr-3 text-xs text-indigo-700 hover:bg-indigo-50"><Folder size={14} className="text-slate-400"/>{folder.name}</Link>)}</div>}</details>)}
      {selectedFolder && childFolders.length > 0 && <section aria-label="Subfolders" className="mt-4 flex flex-wrap gap-2">{childFolders.map((folder) => <Link key={folder.id} href={`/app?folder=${folder.id}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-indigo-300 hover:text-indigo-700"><Folder size={15} className="text-indigo-500"/>{folder.name}</Link>)}</section>}
      {searchError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Search is temporarily unavailable. Please try again.</p>}
      {query && !searchError && <p className="mt-4 text-sm text-slate-500">Search results for <span className="font-medium text-slate-700">“{query}”</span></p>}
      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {documents?.length ? documents.map((document) => <article key={document.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0 sm:px-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><FileText size={17}/></span>
          <Link href={view === "trash" ? "#" : `/app/doc/${document.id}`} className="min-w-0 flex-1">{view === "trash" ? <span className="font-medium">{document.title}</span> : <span className="font-medium hover:text-indigo-700">{document.title}</span>}<span className="mt-1 block truncate text-xs text-slate-400">{view === "shared" ? "Shared with you" : String(("folder_name" in document ? document.folder_name : folderNames.get(document.folder_id ?? "")) ?? "No folder")} · Updated {new Date(document.updated_at).toLocaleDateString("vi-VN")}{"tag_names" in document && Array.isArray(document.tag_names) && document.tag_names.length > 0 ? ` · ${document.tag_names.join(", ")}` : ""}</span></Link>
          {!query && view !== "shared" && <div className="flex items-center gap-1">
            {view === "trash" ? <form action={trashDocumentAction.bind(null, document.id)}><input type="hidden" name="restore" value="true"/><button className="rounded-lg px-2 py-1.5 text-xs text-indigo-700 hover:bg-indigo-50">Restore</button></form> : <>
              <form action={setDocumentFlagAction.bind(null, document.id, "is_favorite", !document.is_favorite)}><button aria-label={document.is_favorite ? "Remove favorite" : "Add favorite"} className={`rounded-lg p-2 hover:bg-slate-50 ${document.is_favorite ? "text-rose-500" : "text-slate-400"}`}><Heart size={16} fill={document.is_favorite ? "currentColor" : "none"}/></button></form>
              <form action={setDocumentFlagAction.bind(null, document.id, "is_archived", !document.is_archived)}><button aria-label={document.is_archived ? "Unarchive" : "Archive"} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"><Archive size={16}/></button></form>
              <form action={trashDocumentAction.bind(null, document.id)}><button aria-label="Move to trash" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16}/></button></form>
            </>}
          </div>}
        </article>) : <div className="px-5 py-10 text-center"><div className="mx-auto grid size-11 place-items-center rounded-2xl bg-slate-50 text-slate-400"><Search size={18}/></div><h2 className="mt-3 font-medium">{query ? "No matching documents" : "Nothing here yet"}</h2><p className="mt-1 text-sm text-slate-500">{query ? "Try a different title, phrase, folder, or tag." : view === "all" ? "Create a document to start collecting your knowledge." : `No documents in ${labels[view].toLowerCase()}.`}</p></div>}
      </section>
      {query ? <nav aria-label="Search result pages" className="mt-4 flex items-center justify-between text-sm">{page > 1 ? <Link className="rounded-lg bg-white px-3 py-2 text-indigo-700 ring-1 ring-slate-200" href={`/app?q=${encodeURIComponent(query)}&page=${page - 1}`}>Previous</Link> : <span/>}<span className="text-slate-400">Page {page}</span>{hasNextPage ? <Link className="rounded-lg bg-white px-3 py-2 text-indigo-700 ring-1 ring-slate-200" href={`/app?q=${encodeURIComponent(query)}&page=${page + 1}`}>Next</Link> : <span/>}</nav> : <p className="mt-4 text-right text-xs text-slate-400">Showing up to 100 documents</p>}
    </main>
  </div>;
}
