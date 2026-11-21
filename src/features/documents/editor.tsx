"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { Archive, AlertCircle, Bold, Check, Code2, Columns2, Download, Eye, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List, ListChecks, ListOrdered, LoaderCircle, Minus, Plus, Quote as QuoteIcon, Redo2, Rows2, Save, Strikethrough, Table2, Tag, Trash2, Underline as UnderlineIcon, Undo2, type LucideIcon } from "lucide-react";
import { listDocumentImagesAction, saveDocumentAction, saveDocumentTagsAction } from "./actions";
import { DocumentImage } from "./image-extension";
import { prepareDocumentImages } from "./image-content";
import { getDocumentImagePaths, getDocumentImageSummary } from "@/lib/supabase/document-assets";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

type EditorDocument = { id: string; title: string; content: Record<string, unknown>; folderId: string | null; tags: string[]; updatedAt: string };
type FolderOption = { id: string; name: string };

export function DocumentEditor({ document, folders, autoSave, onAutoSaveChange, onDone }: {
  document: EditorDocument;
  folders: FolderOption[];
  autoSave: boolean;
  onAutoSaveChange: (value: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [saveState, setSaveState] = useState("All changes saved");
  const [pending, setPending] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [tags, setTags] = useState(document.tags);
  const [tagInput, setTagInput] = useState(document.tags.join(", "));
  const [tagState, setTagState] = useState("");
  const [tagsPending, setTagsPending] = useState(false);
  const [imagePending, setImagePending] = useState(false);
  const [savedImagePickerOpen, setSavedImagePickerOpen] = useState(false);
  const [savedImagePickerPending, setSavedImagePickerPending] = useState(false);
  const [savedImages, setSavedImages] = useState<{ path: string; name: string; createdAt: string | null; attached: boolean }[]>([]);
  const [imageState, setImageState] = useState(() => {
    const summary = getDocumentImageSummary(document.content);
    return summary.imageNodes > summary.paths + summary.sources
      ? "An older image has no saved file reference. Please upload it again."
      : "";
  });
  const imageInput = useRef<HTMLInputElement>(null);
  const imageToReplace = useRef<{ from: number; to: number } | null>(null);
  const pendingImagePaths = useRef<string[]>([]);
  const supabase = useMemo(() => createSupabaseClient(), []);
  const revision = useRef(0);
  const saving = useRef(false);
  const saveAgain = useRef<(() => void) | null>(null);
  const loadedDocumentVersion = useRef(document.updatedAt);
  const initialContent = useMemo(() => prepareDocumentImages(
    document.content,
    (path) => `/app/assets?path=${encodeURIComponent(path)}`,
  ) as Record<string, unknown>, [document.content]);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), TaskList, TaskItem.configure({ nested: true }), TableKit.configure({ table: { resizable: true } }), DocumentImage.configure({ allowBase64: false }), Placeholder.configure({ placeholder: "Start writing…" })],
    content: initialContent,
    onUpdate: () => { revision.current += 1; setHasChanges(true); setSaveState("Unsaved changes"); },
    editorProps: { attributes: { class: "prose-editor focus:outline-none" } },
  });

  useEffect(() => {
    if (!editor || loadedDocumentVersion.current === document.updatedAt) return;
    // Next can preserve this client component across same-segment navigation;
    // Tiptap does not observe changes to the initial `content` option itself.
    editor.commands.setContent(initialContent, { emitUpdate: false });
    loadedDocumentVersion.current = document.updatedAt;
    revision.current = 0;
    setTitle(document.title);
    setHasChanges(false);
    setSaveState("All changes saved");
  }, [document.title, document.updatedAt, editor, initialContent]);

  const save = useCallback(() => {
    if (!editor || saving.current) return;
    const currentRevision = revision.current;
    const content = editor.getJSON();
    setSaveState("Saving changes");
    saving.current = true;
    setPending(true);
    const imagePaths = [...pendingImagePaths.current];
    void saveDocumentAction(document.id, { title, content, imagePaths }).then((result) => {
      if (result.error) {
        setSaveState(result.error);
        setImageState((current) => current.startsWith("Image added.") || current.startsWith("Broken image replaced.") || current.startsWith("Saved image attached.") ? "Image uploaded, but document save failed." : current);
      }
      else if (revision.current === currentRevision) {
        const missingPath = imagePaths.find((path) => !result.savedImagePaths?.includes(path));
        if (missingPath) {
          setSaveState("Image reference was not saved. The image is still pending.");
          setImageState("Image file uploaded, but its reference was not saved to the note.");
          return;
        }
        pendingImagePaths.current = pendingImagePaths.current.filter((path) => !result.savedImagePaths?.includes(path));
        setHasChanges(false);
        setSaveState("All changes saved");
        setImageState((current) => current.startsWith("Image added.") || current.startsWith("Broken image replaced.") || current.startsWith("Saved image attached.") || current.startsWith("Image uploaded, but document save failed.") ? "Image saved with the document." : current);
        router.refresh();
      }
      else setSaveState("Unsaved changes");
    }).catch(() => setSaveState("Save failed. Try again."))
      .finally(() => {
        saving.current = false;
        setPending(false);
        if (revision.current !== currentRevision) window.setTimeout(() => saveAgain.current?.(), 0);
      });
  }, [document.id, editor, router, title]);
  saveAgain.current = save;

  useEffect(() => {
    if (!autoSave || !editor || !hasChanges || saveState !== "Unsaved changes") return;
    const timer = window.setTimeout(save, 1200);
    return () => window.clearTimeout(timer);
  }, [autoSave, editor, hasChanges, save, saveState]);

  const exportDocument = async (format: "markdown" | "json") => {
    if (pending || !editor) return;
    if (hasChanges) {
      setPending(true);
      setSaveState("Saving changes");
      try {
        const result = await saveDocumentAction(document.id, { title, content: editor.getJSON(), imagePaths: [...pendingImagePaths.current] });
        if (result.error) { setSaveState(result.error); return; }
        if (pendingImagePaths.current.some((path) => !result.savedImagePaths?.includes(path))) {
          setSaveState("Image reference was not saved. The image is still pending.");
          setImageState("Image file uploaded, but its reference was not saved to the note.");
          return;
        }
        pendingImagePaths.current = pendingImagePaths.current.filter((path) => !result.savedImagePaths?.includes(path));
        setSaveState("All changes saved");
        setHasChanges(false);
      } catch {
        setSaveState("Save failed. Try again.");
        return;
      } finally {
        setPending(false);
      }
    }
    window.location.assign(`/app/doc/${document.id}/export?format=${format}`);
  };

  const button = (label: string, Icon: LucideIcon, run: () => void, active = false, disabled = false) => <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={run} disabled={disabled} className={`grid size-10 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-indigo-50 text-indigo-700" : ""}`}><Icon aria-hidden size={18} strokeWidth={1.8}/><span className="sr-only">{label}</span></button>;
  const divider = <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-slate-200"/>;

  const saveTags = async (formData: FormData) => {
    setTagsPending(true);
    setTagState("");
    try {
      const result = await saveDocumentTagsAction(document.id, formData);
      if (result.error) { setTagState(result.error); return; }
      const savedTags = result.tags ?? [];
      setTags(savedTags);
      setTagInput(savedTags.join(", "));
      setTagState("Tags saved");
    } catch {
      setTagState("Could not save tags. Please try again.");
    } finally {
      setTagsPending(false);
    }
  };

  const findBrokenImageRange = () => {
    if (!editor) return null;
    const selection = editor.state.selection;
    if (selection instanceof NodeSelection && selection.node.type.name === "image") {
      return { from: selection.from, to: selection.to };
    }
    let firstUnlinked: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, position) => {
      if (firstUnlinked || node.type.name !== "image") return;
      const hasPath = typeof node.attrs.storagePath === "string" && node.attrs.storagePath.length > 0;
      const hasSource = typeof node.attrs.src === "string" && node.attrs.src.length > 0;
      if (!hasPath && !hasSource) firstUnlinked = { from: position, to: position + node.nodeSize };
    });
    return firstUnlinked;
  };

  const writeImageReference = (path: string, alt: string) => {
    if (!editor) return false;
    const replacementRange = imageToReplace.current ?? findBrokenImageRange();
    imageToReplace.current = null;
    const imageNode = {
      type: "image",
      attrs: { src: `/app/assets?path=${encodeURIComponent(path)}`, storagePath: path, alt },
    };
    if (replacementRange) {
      editor.commands.insertContentAt(replacementRange, imageNode, { updateSelection: true });
    } else {
      editor.chain().focus().insertContent(imageNode).run();
    }
    return getDocumentImagePaths(editor.getJSON()).includes(path);
  };

  const openSavedImages = async () => {
    setSavedImagePickerOpen(true);
    setSavedImagePickerPending(true);
    try {
      const result = await listDocumentImagesAction(document.id);
      setSavedImages(result.images ?? []);
      if (result.error) setImageState(result.error);
    } catch {
      setImageState("Could not list saved images for this document.");
    } finally {
      setSavedImagePickerPending(false);
    }
  };

  const attachSavedImage = (path: string) => {
    if (!editor) return;
    if (!writeImageReference(path, "Previously uploaded image")) {
      setImageState("Could not attach this saved image to the note.");
      return;
    }
    if (!pendingImagePaths.current.includes(path)) pendingImagePaths.current.push(path);
    revision.current += 1;
    setHasChanges(true);
    setSaveState("Unsaved changes");
    setImageState(autoSave ? "Saved image attached. Saving the note…" : "Saved image attached. Press Save to keep it in the note.");
    setSavedImagePickerOpen(false);
    if (autoSave) saveAgain.current?.();
  };

  const uploadImage = async (file: File) => {
    if (!editor) { setImageState("The editor is still loading. Try again in a moment."); return; }
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
    if (!extensions[file.type]) { setImageState("Choose a JPG, PNG, WebP, or GIF image."); return; }
    if (file.size > 5 * 1024 * 1024) { setImageState("Images must be 5 MB or smaller."); return; }
    setImagePending(true);
    setImageState("Uploading image…");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) { setImageState("Sign in again before uploading an image."); return; }
      const storagePath = `${user.id}/${document.id}/${crypto.randomUUID()}.${extensions[file.type]}`;
      const { error } = await supabase.storage.from("document-images").upload(storagePath, file, { contentType: file.type, upsert: false });
      if (error) { setImageState(`Image upload failed: ${error.message}`); return; }
      const replacementRange = imageToReplace.current ?? findBrokenImageRange();
      if (!writeImageReference(storagePath, file.name)) {
        await supabase.storage.from("document-images").remove([storagePath]);
        setImageState("Upload reached Storage, but Tiptap did not keep the file path on the image node.");
        return;
      }
      if (!pendingImagePaths.current.includes(storagePath)) pendingImagePaths.current.push(storagePath);
      // Be explicit so the Save button doesn't depend on an editor event firing.
      revision.current += 1;
      setHasChanges(true);
      setSaveState("Unsaved changes");
      const message = replacementRange ? "Broken image replaced." : "Image added.";
      setImageState(autoSave ? `${message} Saving it to the document…` : `${message} Press Save to keep it in the document.`);
      if (autoSave) saveAgain.current?.();
    } catch (error) {
      setImageState(error instanceof Error ? `Image upload failed: ${error.message}` : "Image upload failed. Please try again.");
    } finally {
      setImagePending(false);
    }
  };

  const saveFailed = /failed|could not|not saved|unable to save/i.test(saveState);
  const saveTone = pending ? "bg-indigo-50 text-indigo-700" : saveFailed ? "bg-red-50 text-red-700" : hasChanges ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700";

  return <div className="min-h-[calc(100vh-3.5rem)] bg-[var(--background)] px-4 pb-20 pt-5 sm:px-8 sm:pt-7">
    <div className="mx-auto w-full max-w-4xl">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0 space-y-1.5">
          <span className={`inline-flex min-h-7 items-center gap-2 rounded-full px-2.5 text-xs font-medium ${saveTone}`} aria-live="polite">{pending ? <LoaderCircle size={14} className="animate-spin"/> : saveFailed ? <AlertCircle size={14}/> : hasChanges ? null : <Check size={14} />}{pending ? "Saving changes" : saveState}</span>
          {imageState && <p role={/failed|could not|not saved|no saved file reference/i.test(imageState) ? "alert" : "status"} className={`max-w-2xl text-xs ${/failed|could not|not saved|no saved file reference/i.test(imageState) || imageState.startsWith("Choose") || imageState.startsWith("Images must") ? "text-red-600" : "text-slate-500"}`}>{imageState}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <label className="mr-auto inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-slate-600 hover:bg-slate-50 sm:mr-1"><input type="checkbox" checked={autoSave} onChange={(event) => onAutoSaveChange(event.target.checked)} className="size-4 accent-indigo-600"/>Auto-save</label>
          <button type="button" onClick={() => { if (hasChanges && !window.confirm("Discard unsaved changes and return to reading?")) return; onDone(); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"><Eye size={16}/>Preview</button>
          <details className="relative">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"><Download size={16}/> Export</summary>
            <div className="absolute right-0 top-full z-30 mt-1 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
              <button type="button" onClick={() => void exportDocument("markdown")} disabled={pending} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Download Markdown</button>
              <button type="button" onClick={() => void exportDocument("json")} disabled={pending} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Download JSON</button>
            </div>
          </details>
          {hasChanges && <button type="button" onClick={save} disabled={pending || !editor} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"><Save size={16}/>{pending ? "Saving…" : "Save changes"}</button>}
        </div>
      </div>
      <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
        <input aria-label="Document title" value={title} onChange={(event) => { revision.current += 1; setHasChanges(true); setTitle(event.target.value); setSaveState("Unsaved changes"); }} placeholder="Untitled note" className="w-full border-0 bg-transparent px-7 pb-5 pt-8 text-3xl font-semibold tracking-tight text-slate-900 outline-none placeholder:text-slate-300 sm:px-12 sm:pt-10 sm:text-4xl" />
        <div role="toolbar" aria-label="Document formatting" className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-y border-slate-100 bg-white/95 px-5 py-2 backdrop-blur sm:px-10">
          <div role="group" aria-label="Text style" className="flex items-center gap-0.5">{button("Bold", Bold, () => editor?.chain().focus().toggleBold().run(), editor?.isActive("bold"))}{button("Italic", Italic, () => editor?.chain().focus().toggleItalic().run(), editor?.isActive("italic"))}{button("Underline", UnderlineIcon, () => editor?.chain().focus().toggleUnderline().run(), editor?.isActive("underline"))}{button("Strikethrough", Strikethrough, () => editor?.chain().focus().toggleStrike().run(), editor?.isActive("strike"))}</div>
          {divider}
          <div role="group" aria-label="Headings" className="flex items-center gap-0.5">{button("Heading 1", Heading1, () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), editor?.isActive("heading", { level: 1 }))}{button("Heading 2", Heading2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), editor?.isActive("heading", { level: 2 }))}{button("Heading 3", Heading3, () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), editor?.isActive("heading", { level: 3 }))}</div>
          {divider}
          <div role="group" aria-label="Lists" className="flex items-center gap-0.5">{button("Bulleted list", List, () => editor?.chain().focus().toggleBulletList().run(), editor?.isActive("bulletList"))}{button("Numbered list", ListOrdered, () => editor?.chain().focus().toggleOrderedList().run(), editor?.isActive("orderedList"))}{button("Checklist", ListChecks, () => editor?.chain().focus().toggleTaskList().run(), editor?.isActive("taskList"))}</div>
          {divider}
          <div role="group" aria-label="Insert content" className="flex items-center gap-0.5">{button("Quote", QuoteIcon, () => editor?.chain().focus().toggleBlockquote().run(), editor?.isActive("blockquote"))}{button("Code block", Code2, () => editor?.chain().focus().toggleCodeBlock().run(), editor?.isActive("codeBlock"))}{button("Horizontal rule", Minus, () => editor?.chain().focus().setHorizontalRule().run())}{button("Insert table", Table2, () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}{button("Link", Link2, () => { const href = window.prompt("Link URL"); if (href) editor?.chain().focus().setLink({ href }).run(); }, editor?.isActive("link"))}</div>
          {editor?.isActive("table") && <><span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-indigo-200"/><div role="group" aria-label="Table editing" className="flex items-center gap-0.5 rounded-lg bg-indigo-50/70 px-1">{button("Add row before", Rows2, () => editor.chain().focus().addRowBefore().run())}{button("Add row after", Plus, () => editor.chain().focus().addRowAfter().run())}{button("Delete row", Trash2, () => editor.chain().focus().deleteRow().run())}{button("Add column before", Columns2, () => editor.chain().focus().addColumnBefore().run())}{button("Add column after", Plus, () => editor.chain().focus().addColumnAfter().run())}{button("Delete column", Trash2, () => editor.chain().focus().deleteColumn().run())}{button("Delete table", Table2, () => editor.chain().focus().deleteTable().run())}</div></>}
          {divider}
          <div role="group" aria-label="Images" className="flex items-center gap-1">{<button type="button" onClick={() => void openSavedImages()} disabled={imagePending || savedImagePickerPending} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"><ImageIcon size={16}/>Restore saved image</button>}{button("Upload or replace selected image", ImageIcon, () => {
            const selection = editor?.state.selection;
            imageToReplace.current = selection instanceof NodeSelection && selection.node.type.name === "image"
              ? { from: selection.from, to: selection.to }
              : null;
            imageInput.current?.click();
          }, false, imagePending)}<input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" aria-label="Choose an image" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.target.value = ""; }}/></div>
          {divider}
          <div role="group" aria-label="History" className="flex items-center gap-0.5">{button("Undo", Undo2, () => editor?.chain().focus().undo().run())}{button("Redo", Redo2, () => editor?.chain().focus().redo().run())}</div>
        </div>
        <div className="px-7 pb-12 pt-7 sm:px-12 sm:pb-16 sm:pt-9"><EditorContent editor={editor} /></div>
        {folders.length > 0 && <div className="border-t border-slate-100 px-7 py-4 sm:px-12"><label className="flex items-center gap-3 text-xs font-medium text-slate-500"><Archive size={14}/> Folder <select aria-label="Move to folder" defaultValue={document.folderId ?? ""} onChange={(event) => { const form = new FormData(); form.set("folder_id", event.target.value); void import("./actions").then(({ moveDocumentAction }) => moveDocumentAction(document.id, form)); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-indigo-400"><option value="">No folder</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label></div>}
        <div className="border-t border-slate-100 px-7 py-4 sm:px-12"><form action={saveTags} className="space-y-3">
          <label htmlFor="document-tags" className="flex items-center gap-2 text-xs font-medium text-slate-500"><Tag size={14}/> Tags</label>
          <div className="flex flex-wrap items-center gap-2"><input id="document-tags" name="tags" value={tagInput} onChange={(event) => setTagInput(event.target.value)} maxLength={2000} placeholder="design, meeting notes, ideas" className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"/><button disabled={tagsPending} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{tagsPending ? <LoaderCircle size={14} className="animate-spin"/> : <Check size={14}/>}Save tags</button></div>
          <p className="text-xs text-slate-400">Separate tags with commas. Up to 20 tags per document.</p>
          {tags.length > 0 && <div className="flex flex-wrap gap-1.5">{tags.map((name) => <span key={name} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{name}</span>)}</div>}
          {tagState && <p role={tagState === "Tags saved" ? "status" : "alert"} className={`text-xs ${tagState === "Tags saved" ? "text-emerald-700" : "text-red-600"}`}>{tagState}</p>}
        </form></div>
      </section>
    </div>
    {savedImagePickerOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSavedImagePickerOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="saved-images-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="saved-images-title" className="text-lg font-semibold text-slate-900">Attach an image already saved</h2><p className="mt-1 text-sm text-slate-500">Choose a file from this note’s private Supabase Storage folder.</p></div>
          <button type="button" onClick={() => setSavedImagePickerOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Close</button>
        </div>
        {savedImagePickerPending ? <div role="status" className="grid min-h-40 place-items-center text-sm text-slate-500"><LoaderCircle className="mr-2 inline animate-spin" size={16}/> Looking for saved images…</div>
          : savedImages.length === 0 ? <p className="mt-6 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">No image files were found in this note’s Storage folder.</p>
          : <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{savedImages.map((image) => <button key={image.path} type="button" onClick={() => attachSavedImage(image.path)} className="overflow-hidden rounded-xl border border-slate-200 text-left transition hover:border-indigo-400 hover:ring-2 hover:ring-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
            {/* eslint-disable-next-line @next/next/no-img-element -- Supabase assets are private and require the user's browser session. */}
            <img src={`/app/assets?path=${encodeURIComponent(image.path)}`} alt="Previously uploaded image" loading="lazy" className="aspect-[4/3] w-full bg-slate-100 object-cover"/>
            <span className="block truncate px-3 pt-2 text-xs text-slate-700">{image.attached ? "Linked in note" : "Saved, not linked"}</span><span className="block truncate px-3 pb-2 text-[11px] text-slate-500">{image.createdAt ? new Date(image.createdAt).toLocaleString() : "Saved image"}</span>
          </button>)}</div>}
      </section>
    </div>}
  </div>;
}
