"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarDays, FilePenLine, FolderOpen, Settings2 } from "lucide-react";
import { DocumentEditor } from "./editor";
import { DocumentViewer } from "./document-viewer";

type WorkspaceDocument = {
  id: string;
  title: string;
  content: Record<string, unknown>;
  folderId: string | null;
  tags: string[];
  updatedAt: string;
};
type FolderOption = { id: string; name: string };

const autoSavePreferenceKey = "moc-document-auto-save";

export function DocumentWorkspace({ document, folders, folderName, startInEditMode = false }: { document: WorkspaceDocument; folders: FolderOption[]; folderName?: string; startInEditMode?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(startInEditMode);
  const [autoSave, setAutoSave] = useState(false);

  useEffect(() => {
    setAutoSave(window.localStorage.getItem(autoSavePreferenceKey) === "true");
  }, []);

  const updateAutoSave = (enabled: boolean) => {
    setAutoSave(enabled);
    window.localStorage.setItem(autoSavePreferenceKey, String(enabled));
  };

  const finishEditing = () => {
    setEditing(false);
    if (startInEditMode) router.replace(`/app/doc/${document.id}`, { scroll: false });
  };

  if (editing) return <DocumentEditor
    key={`${document.id}:${document.updatedAt}`}
    document={document}
    folders={folders}
    autoSave={autoSave}
    onAutoSaveChange={updateAutoSave}
    onDone={finishEditing}
  />;

  return <main className="min-h-[calc(100vh-4rem)] bg-[var(--background)] px-4 py-6 sm:px-8 sm:py-9">
    <div className="mx-auto max-w-5xl">
      <article className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
        <header className="border-b border-slate-100 px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-indigo-50 px-3 text-xs font-semibold text-indigo-700"><BookOpen size={14}/> Reading mode</span>
                {folderName && <span className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-3 text-xs text-slate-500"><FolderOpen size={14} className="shrink-0"/><span className="truncate">{folderName}</span></span>}
              </div>
              <h1 className="mt-4 break-words text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">{document.title}</h1>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500"><CalendarDays size={14}/>Updated {new Date(document.updatedAt).toLocaleDateString("vi-VN", { day: "numeric", month: "short", year: "numeric" })}</p>
              {document.tags.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{document.tags.map((tag) => <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600">{tag}</span>)}</div>}
            </div>
            <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2">
              <FilePenLine size={16}/> Edit note
            </button>
          </div>
        </header>
        <section className="px-6 py-7 sm:px-10 sm:py-9" aria-label="Document content">
          <DocumentViewer content={document.content} className="mx-auto max-w-3xl"/>
        </section>
      </article>
      <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-medium"><Settings2 size={15}/> Reading and saving preferences</summary>
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 border-t border-slate-100 pt-3 text-sm">
        <input type="checkbox" checked={autoSave} onChange={(event) => updateAutoSave(event.target.checked)} className="size-4 accent-indigo-600"/>
        Auto-save changes while editing
        </label>
        <p className="pb-1 pl-7 text-xs text-slate-500">Off by default. When off, changes are saved only when you press Save.</p>
      </details>
    </div>
  </main>;
}
