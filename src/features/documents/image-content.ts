import { getDocumentImageStoragePath } from "@/lib/supabase/document-assets";

export function prepareDocumentImages(content: unknown, imageUrl: (path: string) => string): unknown {
  if (Array.isArray(content)) return content.map((node) => prepareDocumentImages(node, imageUrl));
  if (!content || typeof content !== "object") return content;

  const node = content as Record<string, unknown>;
  const result = { ...node };
  if (node.type === "image" && node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs)) {
    const attrs = node.attrs as Record<string, unknown>;
    const path = getDocumentImageStoragePath(attrs);
    if (path) result.attrs = { ...attrs, src: imageUrl(path) };
  }
  if (Array.isArray(node.content)) result.content = prepareDocumentImages(node.content, imageUrl);
  return result;
}
