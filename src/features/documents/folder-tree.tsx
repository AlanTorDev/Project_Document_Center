"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Check, ChevronDown, ChevronRight, Folder, LoaderCircle, Search, X } from "lucide-react";
import { createFolderAction, renameFolderAction } from "./actions";
import { FolderActionsMenu } from "./folder-actions-menu";
import { MAX_SUBFOLDER_DEPTH } from "./folder-constants";

export type FolderTreeNode = { id: string; name: string; parent_id: string | null; children: FolderTreeNode[] };

function InlineSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-busy={pending} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60">
    {pending ? <><LoaderCircle size={14} className="animate-spin"/>{label === "Create" ? "Creating…" : "Saving…"}</> : <><Check size={14}/>{label}</>}
  </button>;
}

export function FolderTree({ folders, selectedFolderId, initiallyExpandedIds }: {
  folders: FolderTreeNode[];
  selectedFolderId: string | null;
  initiallyExpandedIds: string[];
}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set(initiallyExpandedIds));
  const [addingToId, setAddingToId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [error, setError] = useState<{ folderId: string; message: string } | null>(null);
  const [folderQuery, setFolderQuery] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingToId) addInputRef.current?.focus();
  }, [addingToId]);
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const beginAdd = (folderId: string, depth: number) => {
    if (depth >= MAX_SUBFOLDER_DEPTH) return;
    setExpandedIds((current) => new Set(current).add(folderId));
    setRenamingId(null);
    setError(null);
    setAddingToId(folderId);
  };
  const beginRename = (folderId: string) => {
    setAddingToId(null);
    setError(null);
    setRenamingId(folderId);
  };

  const countFolders = (nodes: FolderTreeNode[]): number => nodes.reduce((total, folder) => total + 1 + countFolders(folder.children), 0);
  const totalFolderCount = countFolders(folders);
  const normalizedQuery = folderQuery.trim().toLocaleLowerCase();
  const filterFolders = (nodes: FolderTreeNode[]): FolderTreeNode[] => nodes.flatMap((folder) => {
    const children = filterFolders(folder.children);
    return folder.name.toLocaleLowerCase().includes(normalizedQuery) || children.length > 0 ? [{ ...folder, children }] : [];
  });
  const visibleFolders = normalizedQuery ? filterFolders(folders) : folders;

  const renderNodes = (nodes: FolderTreeNode[], depth = 0): ReactNode => nodes.map((folder) => {
    const hasChildren = folder.children.length > 0;
    const expanded = normalizedQuery ? hasChildren : expandedIds.has(folder.id);
    const createSubfolder = async (formData: FormData) => {
      try {
        await createFolderAction(formData);
        setError(null);
        setAddingToId(null);
      } catch {
        setError({ folderId: folder.id, message: "Could not create the subfolder. Try again." });
      }
    };
    const saveFolderName = async (formData: FormData) => {
      try {
        await renameFolderAction(folder.id, formData);
        setError(null);
        setRenamingId(null);
      } catch {
        setError({ folderId: folder.id, message: "Could not rename this folder. Try again." });
      }
    };
    return <div key={folder.id} className="min-w-0">
      <div className="flex min-h-10 min-w-0 items-center gap-0.5">
        {hasChildren ? <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={expanded} onClick={() => setExpandedIds((current) => {
          const next = new Set(current);
          if (next.has(folder.id)) next.delete(folder.id);
          else next.add(folder.id);
          return next;
        })} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">{expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button> : <span aria-hidden className="w-9 shrink-0"/>}
        <Link href={`/app?folder=${folder.id}`} aria-current={folder.id === selectedFolderId ? "page" : undefined} title={folder.name} className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm ${folder.id === selectedFolderId ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-50"}`}>
          <Folder size={15} aria-hidden className="shrink-0 text-slate-400"/>
          <span className="truncate">{folder.name}</span>
        </Link>
        {renamingId !== folder.id && <FolderActionsMenu folder={folder} canAddSubfolder={depth < MAX_SUBFOLDER_DEPTH} onAddSubfolder={(folderId) => beginAdd(folderId, depth)} onRename={beginRename}/>}
      </div>
      {renamingId === folder.id && <form action={saveFolderName} className="ml-9 space-y-2 rounded-lg py-2">
        <label htmlFor={`rename-folder-${folder.id}`} className="sr-only">Folder name</label>
        <input ref={renameInputRef} id={`rename-folder-${folder.id}`} name="name" defaultValue={folder.name} required maxLength={120} onKeyDown={(event) => { if (event.key === "Escape") setRenamingId(null); }} className="h-11 w-full min-w-0 rounded-lg border border-indigo-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100"/>
        <div className="flex items-center justify-end gap-2"><InlineSubmitButton label="Save"/><button type="button" aria-label="Cancel rename" onClick={() => setRenamingId(null)} className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X size={17}/></button></div>
      </form>}
      {addingToId === folder.id && <form action={createSubfolder} className="ml-9 space-y-2 rounded-lg py-2">
        <input type="hidden" name="parent_id" value={folder.id}/>
        <label htmlFor={`new-subfolder-${folder.id}`} className="sr-only">New subfolder name</label>
        <input ref={addInputRef} id={`new-subfolder-${folder.id}`} name="name" required maxLength={120} placeholder="New subfolder name" onKeyDown={(event) => { if (event.key === "Escape") setAddingToId(null); }} className="h-11 w-full min-w-0 rounded-lg border border-indigo-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-100"/>
        <div className="flex items-center justify-end gap-2"><InlineSubmitButton label="Create"/><button type="button" aria-label="Cancel subfolder creation" onClick={() => setAddingToId(null)} className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X size={17}/></button></div>
      </form>}
      {error?.folderId === folder.id && <p role="alert" className="ml-9 pb-1 text-xs text-red-700">{error.message}</p>}
      {hasChildren && expanded && <div className="ml-3 border-l border-slate-200 pl-1">{renderNodes(folder.children, depth + 1)}</div>}
    </div>;
  });

  return <div className="mt-1">
    {totalFolderCount > 8 && <label className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-400 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
      <Search size={15} aria-hidden className="shrink-0"/>
      <span className="sr-only">Search folders</span>
      <input value={folderQuery} onChange={(event) => setFolderQuery(event.target.value)} placeholder="Search folders" className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"/>
      {folderQuery && <button type="button" onClick={() => setFolderQuery("")} aria-label="Clear folder search" className="text-xs text-indigo-600">Clear</button>}
    </label>}
    {normalizedQuery && visibleFolders.length === 0 ? <p className="px-3 py-3 text-sm text-slate-500">No folders found.</p> : <div className="space-y-0.5">{renderNodes(visibleFolders)}</div>}
  </div>;
}
