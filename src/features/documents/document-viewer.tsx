"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo } from "react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { DocumentImage } from "./image-extension";
import { prepareDocumentImages } from "./image-content";
import { getShareScopedDocumentImagePath } from "@/lib/supabase/document-assets";

export function DocumentViewer({ content, shareToken, assetScope, className = "" }: { content: Record<string, unknown>; shareToken?: string; assetScope?: string | null; className?: string }) {
  const displayContent = useMemo(() => prepareDocumentImages(content, (path) => shareToken
    ? `/share/${shareToken}/asset?path=${encodeURIComponent(assetScope ? getShareScopedDocumentImagePath(path, assetScope) ?? path : path)}`
    : `/app/assets?path=${encodeURIComponent(path)}`) as Record<string, unknown>, [content, shareToken, assetScope]);
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), TableKit, DocumentImage.configure({ allowBase64: false })],
    content: displayContent,
    editorProps: { attributes: { class: `prose-editor min-h-0 focus:outline-none ${className}`.trim() } },
  });
  useEffect(() => {
    if (editor) editor.commands.setContent(displayContent, { emitUpdate: false });
  }, [displayContent, editor]);
  return <EditorContent editor={editor}/>;
}
