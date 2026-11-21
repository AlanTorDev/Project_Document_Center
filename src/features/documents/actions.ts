"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { attachDocumentImageReference, documentImageBucket, getDocumentImagePaths, getDocumentImageSummary, isDocumentImagePath, preserveDocumentImageReferences } from "@/lib/supabase/document-assets";
import { documentToMarkdown, documentToSearchText, type DocumentNode } from "./markdown";
import { MAX_SUBFOLDER_DEPTH } from "./folder-constants";

const titleSchema = z.string().trim().min(1, "Title is required.").max(500);
const uuidSchema = z.string().uuid();
const shareExpirationSchema = z.enum(["7", "30", "never"]);
export type ShareLinkActionState = { token?: string; error?: string };
export type EmailShareActionState = { success?: boolean; message?: string; error?: string };
const emailSchema = z.string().trim().email().max(320);
const tagInputSchema = z.string().max(2000);

const contentSchema = z.custom<DocumentNode>((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  // Validate only Tiptap's outer document envelope. Extension-defined node
  // attrs can contain optional or nullable values and must survive unchanged.
  return document.type === "doc"
    && Array.isArray(document.content)
    && document.content.every((node) => node !== null && typeof node === "object" && !Array.isArray(node));
});

async function currentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function currentUserAndWorkspace() {
  const supabase = await createClient();
  const [{ data: { user } }, { data: workspace, error }] = await Promise.all([
    supabase.auth.getUser(),
    // Workspace RLS already limits this query to the signed-in owner.
    supabase.from("workspaces").select("id,name").order("created_at").limit(1).maybeSingle(),
  ]);
  if (!user) redirect("/login");
  if (error || !workspace) throw new Error("Your personal workspace could not be found.");
  return { supabase, user, workspace };
}

export async function createDocumentAction(formData: FormData) {
  const { supabase, user, workspace } = await currentUserAndWorkspace();
  const requestedFolderId = formData.get("folder_id");
  let folderId: string | null = null;
  if (typeof requestedFolderId === "string" && requestedFolderId) {
    const parsedFolderId = uuidSchema.safeParse(requestedFolderId);
    if (!parsedFolderId.success) throw new Error("Choose a valid folder.");
    const { data: folder } = await supabase.from("folders").select("id")
      .eq("id", parsedFolderId.data).eq("workspace_id", workspace.id)
      .eq("created_by", user.id).is("deleted_at", null).maybeSingle();
    if (!folder) throw new Error("This folder is not available.");
    folderId = folder.id;
  }
  const { data, error } = await supabase.from("documents").insert({ workspace_id: workspace.id, owner_id: user.id, folder_id: folderId, title: "Untitled" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Could not create document.");
  revalidatePath("/app");
  redirect(`/app/doc/${data.id}?edit=1`);
}

export async function saveDocumentAction(documentId: string, input: { title: string; content: unknown; imagePaths?: string[] }) {
  const id = uuidSchema.safeParse(documentId);
  const title = titleSchema.safeParse(input.title);
  const content = contentSchema.safeParse(input.content);
  if (!id.success) return { error: "This document link is invalid. Reload the document and try again." };
  if (!title.success) return { error: "Enter a document title of 1 to 500 characters." };
  if (!content.success) return { error: "The editor content could not be saved. Try removing and re-inserting the last item." };
  const { supabase, user } = await currentUser();
  // Strip undefined extension attrs the same way JSONB serialization does.
  let json = JSON.parse(JSON.stringify(content.data)) as DocumentNode;
  const { data: existingDocument, error: existingError } = await supabase.from("documents")
    .select("content_json").eq("id", id.data).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (existingError || !existingDocument) return { error: "Could not read the current document before saving. Reload it and try again." };
  if (process.env.NODE_ENV === "development") console.info("[image-audit:incoming]", id.data, {
    submitted: getDocumentImageSummary(json), existing: getDocumentImageSummary(existingDocument.content_json),
  });
  json = preserveDocumentImageReferences(json, existingDocument.content_json) as DocumentNode;
  const requestedImagePaths = Array.from(new Set(input.imagePaths ?? []));
  if (requestedImagePaths.some((path) => {
    const parts = path.split("/");
    return !isDocumentImagePath(path) || parts[0] !== user.id || parts[1] !== id.data;
  })) return { error: "The image path does not belong to this document." };
  for (const path of requestedImagePaths) json = attachDocumentImageReference(json, path, "Document image") as DocumentNode;
  const { data: savedDocument, error } = await supabase.from("documents").update({ title: title.data, content_json: json, content_markdown: documentToMarkdown(json), search_text: documentToSearchText(json), updated_at: new Date().toISOString() }).eq("id", id.data).eq("owner_id", user.id).is("deleted_at", null).select("content_json").maybeSingle();
  if (error) {
    console.error("Document save failed", { code: error.code, message: error.message });
    return { error: `Could not save the document${error.code ? ` (${error.code})` : ""}. Please try again.` };
  }
  if (!savedDocument) return { error: "Document update returned no editable row. Reload the document and try again." };
  const expectedImages = getDocumentImagePaths(json);
  const savedImages = getDocumentImagePaths(savedDocument.content_json);
  if (process.env.NODE_ENV === "development") console.info("[image-audit:save]", id.data, getDocumentImageSummary(json), getDocumentImageSummary(savedDocument.content_json));
  if (expectedImages.some((path) => !savedImages.includes(path))) return { error: "The document was saved, but an image could not be attached. Please insert it again." };
  revalidatePath("/app");
  revalidatePath(`/app/doc/${id.data}`);
  return { savedAt: new Date().toISOString(), savedImagePaths: savedImages };
}

export async function listDocumentImagesAction(documentId: string): Promise<{ images?: { path: string; name: string; createdAt: string | null; attached: boolean }[]; error?: string }> {
  const id = uuidSchema.safeParse(documentId);
  if (!id.success) return { error: "Invalid document." };
  const { supabase, user } = await currentUser();
  const { data: owned, error: documentError } = await supabase.from("documents")
    .select("id,content_json").eq("id", id.data).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (documentError || !owned) return { error: "You do not have access to this document." };

  const prefix = `${user.id}/${id.data}`;
  const { data, error } = await supabase.storage.from(documentImageBucket).list(prefix, {
    limit: 100,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) return { error: "Could not list saved images for this document." };

  const attached = new Set(getDocumentImagePaths(owned.content_json));
  const images = (data ?? []).filter((file) => file.id && file.name && !file.name.startsWith("."))
    .map((file) => {
      const path = `${prefix}/${file.name}`;
      return { path, name: file.name, createdAt: file.created_at ?? null, attached: attached.has(path) };
    })
    .filter((file) => isDocumentImagePath(file.path));
  return { images };
}

export async function setDocumentFlagAction(documentId: string, flag: "is_favorite" | "is_archived", value: boolean) {
  const id = uuidSchema.safeParse(documentId);
  if (!id.success) return;
  const { supabase, user } = await currentUser();
  await supabase.from("documents").update({ [flag]: value }).eq("id", id.data).eq("owner_id", user.id).is("deleted_at", null);
  revalidatePath("/app");
}

export async function moveDocumentAction(documentId: string, formData: FormData) {
  const folderId = formData.get("folder_id");
  const id = uuidSchema.safeParse(documentId);
  if (!id.success || (folderId !== "" && !uuidSchema.safeParse(folderId).success)) return;
  const { supabase, user } = await currentUser();
  const { data: document, error: documentError } = await supabase.from("documents").select("id,workspace_id")
    .eq("id", id.data).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (documentError || !document) throw new Error("This document is not available to move.");
  if (folderId) {
    const parsedFolderId = uuidSchema.safeParse(folderId);
    if (!parsedFolderId.success) throw new Error("Choose a valid folder.");
    const { data: folder, error: folderError } = await supabase.from("folders").select("id")
      .eq("id", parsedFolderId.data).eq("workspace_id", document.workspace_id)
      .eq("created_by", user.id).is("deleted_at", null).maybeSingle();
    if (folderError || !folder) throw new Error("Choose an active folder in this workspace.");
  }
  const { data: moved, error } = await supabase.from("documents").update({ folder_id: folderId || null })
    .eq("id", id.data).eq("workspace_id", document.workspace_id).eq("owner_id", user.id)
    .is("deleted_at", null).select("id").maybeSingle();
  if (error || !moved) throw new Error("Could not move this document.");
  revalidatePath("/app");
  revalidatePath(`/app/doc/${id.data}`);
}

export async function trashDocumentAction(documentId: string, formData?: FormData) {
  const restore = formData?.get("restore") === "true";
  const id = uuidSchema.safeParse(documentId);
  if (!id.success) return;
  const { supabase, user } = await currentUser();
  await supabase.from("documents").update({ deleted_at: restore ? null : new Date().toISOString() }).eq("id", id.data).eq("owner_id", user.id);
  revalidatePath("/app");
  if (!restore) redirect("/app?view=all");
}

export async function createFolderAction(formData: FormData) {
  const name = titleSchema.max(120).safeParse(formData.get("name"));
  if (!name.success) return;
  const { supabase, user, workspace } = await currentUserAndWorkspace();
  const requestedParentId = formData.get("parent_id");
  let parentId: string | null = null;
  if (typeof requestedParentId === "string" && requestedParentId) {
    const parsedParentId = uuidSchema.safeParse(requestedParentId);
    if (!parsedParentId.success) throw new Error("Choose a valid parent folder.");
    const { data: parent } = await supabase.from("folders").select("id,parent_id")
      .eq("id", parsedParentId.data).eq("workspace_id", workspace.id)
      .eq("created_by", user.id).is("deleted_at", null).maybeSingle();
    if (!parent) throw new Error("The parent folder is not available.");
    let parentDepth = 0;
    let ancestorId = parent.parent_id;
    const visitedAncestors = new Set([parent.id]);
    while (ancestorId) {
      if (visitedAncestors.has(ancestorId)) throw new Error("This folder hierarchy is invalid.");
      visitedAncestors.add(ancestorId);
      const { data: ancestor, error: ancestorError } = await supabase.from("folders").select("id,parent_id")
        .eq("id", ancestorId).eq("workspace_id", workspace.id)
        .eq("created_by", user.id).is("deleted_at", null).maybeSingle();
      if (ancestorError || !ancestor) throw new Error("The parent folder is not available.");
      parentDepth += 1;
      ancestorId = ancestor.parent_id;
    }
    if (parentDepth >= MAX_SUBFOLDER_DEPTH) throw new Error(`Folders can be nested up to ${MAX_SUBFOLDER_DEPTH} levels.`);
    parentId = parent.id;
  }
  const { error } = await supabase.from("folders").insert({
    workspace_id: workspace.id, parent_id: parentId, created_by: user.id, name: name.data,
  });
  if (error) throw new Error("Could not create this folder.");
  revalidatePath("/app");
}

export async function renameFolderAction(folderId: string, formData: FormData) {
  const id = uuidSchema.safeParse(folderId);
  const name = titleSchema.max(120).safeParse(formData.get("name"));
  if (!id.success || !name.success) return;
  const { supabase, user } = await currentUser();
  const { data: renamed, error } = await supabase.from("folders").update({ name: name.data })
    .eq("id", id.data).eq("created_by", user.id).is("deleted_at", null).select("id").maybeSingle();
  if (error || !renamed) throw new Error("Could not rename this folder.");
  revalidatePath("/app");
}

export async function trashFolderAction(folderId: string) {
  const id = uuidSchema.safeParse(folderId);
  if (!id.success) return;
  const { supabase, user } = await currentUser();
  const { data: deleted, error } = await supabase.from("folders").update({ deleted_at: new Date().toISOString() })
    .eq("id", id.data).eq("created_by", user.id).is("deleted_at", null).select("id").maybeSingle();
  if (error || !deleted) throw new Error("Could not delete this folder.");
  revalidatePath("/app");
}

async function removeShareScopedImages(supabase: Awaited<ReturnType<typeof createClient>>, prefix: string) {
  const storage = supabase.storage.from(documentImageBucket);
  const { data } = await storage.list(prefix, { limit: 1000 });
  const paths = (data ?? []).filter((file) => file.id && file.name && !file.name.startsWith("."))
    .map((file) => `${prefix}/${file.name}`);
  for (let index = 0; index < paths.length; index += 100) {
    await storage.remove(paths.slice(index, index + 100));
  }
}

export async function createShareLinkAction(documentId: string, _previousState: ShareLinkActionState, formData: FormData): Promise<ShareLinkActionState> {
  const id = uuidSchema.safeParse(documentId);
  const expiration = shareExpirationSchema.safeParse(formData.get("expires_in"));
  if (!id.success || !expiration.success) return { error: "Choose a valid link expiration." };
  const { supabase, user } = await currentUser();
  const { data: document } = await supabase.from("documents").select("content_json")
    .eq("id", id.data).eq("owner_id", user.id).is("deleted_at", null).maybeSingle();
  if (!document) return { error: "This document is not available to share." };
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = expiration.data === "never" ? null : new Date(Date.now() + Number(expiration.data) * 24 * 60 * 60 * 1000).toISOString();
  const imagePaths = Array.from(new Set(getDocumentImagePaths(document.content_json)));
  if (imagePaths.some((path) => {
    const parts = path.split("/");
    return !isDocumentImagePath(path) || parts[0] !== user.id || parts[1] !== id.data;
  })) return { error: "This document contains an invalid image reference. Repair the image before sharing." };

  const storage = supabase.storage.from(documentImageBucket);
  const scopedPaths: string[] = [];
  for (const path of imagePaths) {
    const [, , filename] = path.split("/");
    const scopedPath = `${user.id}/${id.data}/${tokenHash}/${filename}`;
    const { data: image, error: downloadError } = await storage.download(path);
    if (downloadError || !image) {
      if (scopedPaths.length) await storage.remove(scopedPaths);
      return { error: "Could not prepare this note's images for secure sharing. Try again." };
    }
    const { error: uploadError } = await storage.upload(scopedPath, image, { contentType: image.type, upsert: false });
    if (uploadError) {
      await storage.remove([...scopedPaths, scopedPath]);
      return { error: "Could not prepare this note's images for secure sharing. Try again." };
    }
    scopedPaths.push(scopedPath);
  }

  const { error } = await supabase.from("document_share_links").insert({
    document_id: id.data, token_hash: tokenHash, expires_at: expiresAt, created_by: user.id, asset_scope_ready: true,
  });
  if (error) {
    await storage.remove(scopedPaths);
    return { error: "Could not create the link. Apply migration 202611210001, then try again." };
  }
  revalidatePath(`/app/doc/${id.data}`);
  return { token };
}

export async function revokeShareLinkAction(documentId: string, shareLinkId: string) {
  const docId = uuidSchema.safeParse(documentId);
  const linkId = uuidSchema.safeParse(shareLinkId);
  if (!docId.success || !linkId.success) return;
  const { supabase, user } = await currentUser();
  const { data: share } = await supabase.from("document_share_links").select("token_hash")
    .eq("id", linkId.data).eq("document_id", docId.data).maybeSingle();
  const { data: revoked, error } = await supabase.from("document_share_links").update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId.data).eq("document_id", docId.data).is("revoked_at", null).select("id").maybeSingle();
  if (error || !revoked) throw new Error("Could not revoke this share link.");
  if (share?.token_hash) await removeShareScopedImages(supabase, `${user.id}/${docId.data}/${share.token_hash}`);
  revalidatePath(`/app/doc/${docId.data}`);
}

export async function shareDocumentWithEmailAction(documentId: string, _previousState: EmailShareActionState, formData: FormData): Promise<EmailShareActionState> {
  const id = uuidSchema.safeParse(documentId);
  const email = emailSchema.safeParse(formData.get("email"));
  if (!id.success || !email.success) return { error: "Enter a valid email address." };
  const { supabase } = await currentUser();
  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }>;
  }).rpc("share_document_with_email", { target_document: id.data, target_email: email.data });
  if (error) return { error: "Could not share the document. Apply the registered sharing migration, then try again." };
  if (!data) return { error: "No registered account uses that email address." };
  revalidatePath(`/app/doc/${id.data}`);
  revalidatePath("/app");
  return { success: true, message: "Read-only access granted." };
}

export async function revokeDocumentShareAction(documentId: string, shareId: string) {
  const docId = uuidSchema.safeParse(documentId);
  const id = uuidSchema.safeParse(shareId);
  if (!docId.success || !id.success) return;
  const { supabase } = await currentUser();
  await supabase.from("document_shares").update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data).eq("document_id", docId.data).is("revoked_at", null);
  revalidatePath(`/app/doc/${docId.data}`);
  revalidatePath("/app");
}

export async function saveDocumentTagsAction(documentId: string, formData: FormData): Promise<{ tags?: string[]; error?: string }> {
  const id = uuidSchema.safeParse(documentId);
  const input = tagInputSchema.safeParse(formData.get("tags"));
  if (!id.success || !input.success) return { error: "Enter valid tag names." };
  const names = Array.from(new Map(input.data.split(/[\n,]/).map((name) => name.trim()).filter(Boolean).map((name) => [name.toLowerCase(), name])).values());
  if (names.length > 20) return { error: "A document can have at most 20 tags." };
  if (names.some((name) => name.length > 80)) return { error: "Tag names must be 80 characters or fewer." };

  const { supabase } = await currentUser();
  const { data, error } = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: { id: string; name: string }[] | null; error: { message: string } | null }>;
  }).rpc("set_document_tags", { target_document: id.data, requested_names: names });
  if (error) return { error: "Could not save tags. Apply the document tag management migration, then try again." };
  revalidatePath("/app");
  revalidatePath(`/app/doc/${id.data}`);
  return { tags: (data ?? []).map((tag) => tag.name) };
}
