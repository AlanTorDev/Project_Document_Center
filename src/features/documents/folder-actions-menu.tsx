"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, FolderPlus, Pencil, Trash2, LoaderCircle } from "lucide-react";
import { trashFolderAction } from "./actions";

export function FolderActionsMenu({ folder, canAddSubfolder, onAddSubfolder, onRename }: {
  folder: { id: string; name: string };
  canAddSubfolder: boolean;
  onAddSubfolder: (folderId: string) => void;
  onRename: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      const popup = popupRef.current;
      if (!trigger || !popup) return;
      const rect = trigger.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const left = Math.min(Math.max(8, rect.right + 8), Math.max(8, window.innerWidth - popupRect.width - 8));
      const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - popupRect.height - 8));
      setPosition({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, error]);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const deleteFolder = async () => {
    if (!window.confirm(`Move “${folder.name}” to trash? Its documents will remain in your workspace.`)) return;
    setDeleting(true);
    setError("");
    try {
      await trashFolderAction(folder.id);
      setOpen(false);
    } catch {
      setError("Could not delete this folder. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  return <div ref={menuRef} className="relative shrink-0">
    <button ref={triggerRef} type="button" aria-label={`Actions for ${folder.name}`} aria-expanded={open} aria-haspopup="true" aria-controls={`folder-actions-${folder.id}`} title={`Actions for ${folder.name}`} onClick={() => { setOpen((value) => !value); setError(""); }} className="grid size-9 cursor-pointer place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <MoreHorizontal size={18}/>
    </button>
    {open && typeof document !== "undefined" && createPortal(<section ref={popupRef} id={`folder-actions-${folder.id}`} aria-label={`Folder actions for ${folder.name}`} style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? "visible" : "hidden" }} className="fixed z-[100] w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
      <button type="button" disabled={deleting || !canAddSubfolder} title={canAddSubfolder ? undefined : "Maximum nesting depth is 3 levels."} onClick={() => { onAddSubfolder(folder.id); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"><FolderPlus size={16} className="text-slate-500"/>Add subfolder{!canAddSubfolder && <span className="ml-auto text-[10px] text-slate-400">Max 3</span>}</button>
      <button type="button" disabled={deleting} onClick={() => { onRename(folder.id); setOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"><Pencil size={16} className="text-slate-500"/>Rename</button>
      <div className="my-1 border-t border-slate-100"/>
      <button type="button" disabled={deleting} onClick={() => void deleteFolder()} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-60">{deleting ? <LoaderCircle size={16} className="animate-spin"/> : <Trash2 size={16}/>}Move to trash</button>
      {error && <p role="alert" className="px-3 py-2 text-xs text-red-700">{error}</p>}
    </section>, document.body)}
  </div>;
}
