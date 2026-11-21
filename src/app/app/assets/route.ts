import { createClient } from "@/lib/supabase/server";
import { documentContainsImagePath, isDocumentImagePath } from "@/lib/supabase/document-assets";
import { documentImageResponse } from "@/lib/supabase/document-image-response";

type SharedDocument = { content_json: unknown };

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isDocumentImagePath(path)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const documentId = path.split("/")[1];
  const { data: owned } = await supabase.from("documents").select("content_json")
    .eq("id", documentId).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (owned) {
    // Owners can preview a just-uploaded image before the editor's debounced
    // autosave has written its storagePath into content_json.
    if (path.split("/")[0] !== user.id) return new Response("Not found", { status: 404 });
    return documentImageResponse(supabase, path);
  }

  const { data } = await supabase.rpc("get_registered_shared_document", { target_document: documentId }) as unknown as { data: SharedDocument[] | null; error: unknown };
  if (!documentContainsImagePath(data?.[0]?.content_json, path)) return new Response("Not found", { status: 404 });
  return documentImageResponse(supabase, path);
}
