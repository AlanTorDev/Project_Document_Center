import { createClient } from "@/lib/supabase/server";
import { documentContainsImagePath, getOriginalDocumentImagePathFromShareScope, isDocumentImagePath, isShareScopedDocumentImagePath } from "@/lib/supabase/document-assets";
import { documentImageResponse } from "@/lib/supabase/document-image-response";

type SharedDocument = { content_json: unknown; asset_scope: string | null };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const path = new URL(request.url).searchParams.get("path");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !path || (!isDocumentImagePath(path) && !isShareScopedDocumentImagePath(path))) {
    return new Response("Not found", { status: 404 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_document", { share_token: token }) as unknown as { data: SharedDocument[] | null; error: unknown };
  const document = error ? null : data?.[0];
  const originalPath = document?.asset_scope
    ? getOriginalDocumentImagePathFromShareScope(path, document.asset_scope)
    : isDocumentImagePath(path) ? path : null;
  if (!originalPath || !documentContainsImagePath(document?.content_json, originalPath)) return new Response("Not found", { status: 404 });
  return documentImageResponse(supabase, path);
}
