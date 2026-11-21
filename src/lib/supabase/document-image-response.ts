import { documentImageBucket, documentImageMimeTypes, isDocumentImagePath, isShareScopedDocumentImagePath } from "./document-assets";

export async function documentImageResponse(
  supabase: { storage: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: unknown }> } } },
  path: string,
) {
  if (!isDocumentImagePath(path) && !isShareScopedDocumentImagePath(path)) return new Response("Not found", { status: 404 });
  const { data, error } = await supabase.storage.from(documentImageBucket).download(path);
  if (error || !data || !documentImageMimeTypes.includes(data.type as (typeof documentImageMimeTypes)[number])) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": data.type,
      "Content-Length": String(data.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
