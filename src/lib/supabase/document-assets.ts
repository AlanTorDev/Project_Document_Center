export const documentImageBucket = "document-images";
export const documentImageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filenamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i;

export function isDocumentImagePath(path: string) {
  const parts = path.split("/");
  return parts.length === 3 && uuidPattern.test(parts[0]) && uuidPattern.test(parts[1]) && filenamePattern.test(parts[2]);
}

export function getShareScopedDocumentImagePath(path: string, assetScope: string): string | null {
  if (!isDocumentImagePath(path) || !/^[0-9a-f]{64}$/.test(assetScope)) return null;
  const [ownerId, documentId, filename] = path.split("/");
  return `${ownerId}/${documentId}/${assetScope}/${filename}`;
}

export function isShareScopedDocumentImagePath(path: string) {
  const parts = path.split("/");
  return parts.length === 4 && uuidPattern.test(parts[0]) && uuidPattern.test(parts[1])
    && /^[0-9a-f]{64}$/.test(parts[2]) && filenamePattern.test(parts[3]);
}

export function getOriginalDocumentImagePathFromShareScope(path: string, assetScope: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(assetScope) || !isShareScopedDocumentImagePath(path)) return null;
  const parts = path.split("/");
  if (parts[2] !== assetScope) return null;
  return `${parts[0]}/${parts[1]}/${parts[3]}`;
}

export function getDocumentImageStoragePath(attrs: Record<string, unknown> | null | undefined): string | null {
  if (typeof attrs?.storagePath === "string" && isDocumentImagePath(attrs.storagePath)) return attrs.storagePath;
  if (typeof attrs?.src !== "string") return null;
  try {
    const url = new URL(attrs.src, "http://moc.local");
    if (url.pathname !== "/app/assets" && !/^\/share\/[A-Za-z0-9_-]{43}\/asset$/.test(url.pathname)) return null;
    const path = url.searchParams.get("path");
    return path && isDocumentImagePath(path) ? path : null;
  } catch {
    return null;
  }
}

export function attachDocumentImageReference(content: unknown, path: string, alt: string): unknown {
  if (!isDocumentImagePath(path) || getDocumentImagePaths(content).includes(path)) return content;
  const src = `/app/assets?path=${encodeURIComponent(path)}`;
  let attached = false;

  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    const result: Record<string, unknown> = { ...node };
    if (node.type === "image" && !attached) {
      const attrs = node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs)
        ? node.attrs as Record<string, unknown>
        : {};
      if (!getDocumentImageStoragePath(attrs) && !(typeof attrs.src === "string" && attrs.src.trim())) {
        result.attrs = { ...attrs, src, storagePath: path, alt };
        attached = true;
      }
    }
    if (Array.isArray(node.content)) result.content = node.content.map(visit);
    return result;
  };

  const result = visit(content);
  if (attached || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const document = result as Record<string, unknown>;
  const children = Array.isArray(document.content) ? document.content : [];
  return { ...document, content: [...children, { type: "image", attrs: { src, storagePath: path, alt } }] };
}

export function documentContainsImagePath(content: unknown, path: string): boolean {
  if (Array.isArray(content)) return content.some((node) => documentContainsImagePath(node, path));
  if (!content || typeof content !== "object") return false;
  const node = content as Record<string, unknown>;
  const attrs = node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs) ? node.attrs as Record<string, unknown> : null;
  if (node.type === "image" && getDocumentImageStoragePath(attrs) === path) return true;
  return Array.isArray(node.content) && node.content.some((child) => documentContainsImagePath(child, path));
}

export function getDocumentImagePaths(content: unknown): string[] {
  if (Array.isArray(content)) return content.flatMap(getDocumentImagePaths);
  if (!content || typeof content !== "object") return [];
  const node = content as Record<string, unknown>;
  const attrs = node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs) ? node.attrs as Record<string, unknown> : null;
  const storagePath = node.type === "image" ? getDocumentImageStoragePath(attrs) : null;
  const current = storagePath ? [storagePath] : [];
  return current.concat(Array.isArray(node.content) ? node.content.flatMap(getDocumentImagePaths) : []);
}

/** Keep already-saved storage references if the editor submits an image node without its custom attrs. */
export function preserveDocumentImageReferences(content: unknown, previousContent: unknown): unknown {
  const previousImages: { path: string | null; attrs: Record<string, unknown> }[] = [];
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const attrs = node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs)
      ? node.attrs as Record<string, unknown> : null;
    if (node.type === "image") {
      const path = getDocumentImageStoragePath(attrs);
      previousImages.push({ path, attrs: attrs ?? {} });
    }
    if (Array.isArray(node.content)) node.content.forEach(collect);
  };
  collect(previousContent);

  let imageIndex = 0;
  const restore = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(restore);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    const result: Record<string, unknown> = { ...node };
    if (node.type === "image") {
      const previousImage = previousImages[imageIndex++];
      const attrs = node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs)
        ? node.attrs as Record<string, unknown> : {};
      const hasExplicitSource = typeof attrs.src === "string" && attrs.src.trim().length > 0;
      if (!getDocumentImageStoragePath(attrs) && !hasExplicitSource && previousImage?.path) {
        const { path, attrs: oldAttrs } = previousImage;
        result.attrs = {
          ...oldAttrs,
          ...attrs,
          src: `/app/assets?path=${encodeURIComponent(path)}`,
          storagePath: path,
          alt: attrs.alt ?? oldAttrs.alt,
          title: attrs.title ?? oldAttrs.title,
        };
      }
    }
    if (Array.isArray(node.content)) result.content = node.content.map(restore);
    return result;
  };
  return restore(content);
}

export function getDocumentImageSummary(content: unknown): { imageNodes: number; paths: number; sources: number } {
  if (Array.isArray(content)) return content.reduce((total, node) => {
    const current = getDocumentImageSummary(node);
    return { imageNodes: total.imageNodes + current.imageNodes, paths: total.paths + current.paths, sources: total.sources + current.sources };
  }, { imageNodes: 0, paths: 0, sources: 0 });
  if (!content || typeof content !== "object") return { imageNodes: 0, paths: 0, sources: 0 };
  const node = content as Record<string, unknown>;
  const attrs = node.attrs && typeof node.attrs === "object" && !Array.isArray(node.attrs) ? node.attrs as Record<string, unknown> : null;
  const child = Array.isArray(node.content) ? getDocumentImageSummary(node.content) : { imageNodes: 0, paths: 0, sources: 0 };
  if (node.type !== "image") return child;
  return {
    imageNodes: child.imageNodes + 1,
    paths: child.paths + (getDocumentImageStoragePath(attrs) ? 1 : 0),
    sources: child.sources + (typeof attrs?.src === "string" && attrs.src.length > 0 ? 1 : 0),
  };
}
