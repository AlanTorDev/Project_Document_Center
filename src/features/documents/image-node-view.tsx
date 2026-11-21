"use client";
/* eslint @next/next/no-img-element: "off" -- private image URLs require the signed-in browser session and cannot use the server image optimizer. */

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

function ImageWithLoadState({ src, alt }: { src: string; alt: string }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) setStatus(image.naturalWidth > 0 ? "loaded" : "error");
  }, []);

  return <div className="relative my-3 min-h-40 w-full max-w-3xl overflow-hidden rounded-xl bg-slate-100" aria-busy={status === "loading"}>
    {status === "loading" && <div role="status" className="absolute inset-0 z-10 grid min-h-40 place-items-center bg-slate-100">
      <div className="flex items-center gap-3 text-sm text-slate-500"><span aria-hidden className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500"/><span>Loading image…</span></div>
    </div>}
    {status === "error" && <div role="img" aria-label={alt ? `Could not load ${alt}` : "Could not load image"} className="grid min-h-40 place-items-center px-4 text-center text-sm text-red-600">Image request failed. Check your connection or storage access.</div>}
    <img ref={imageRef} src={src} alt={alt} draggable={false} onLoad={() => setStatus("loaded")} onError={() => setStatus("error")} className={`mx-auto h-auto max-w-full rounded-xl transition-opacity ${status === "loaded" ? "opacity-100" : "opacity-0"}`}/>
  </div>;
}

export function DocumentImageNodeView({ node, selected }: NodeViewProps) {
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";

  return <NodeViewWrapper className={`document-image-node ${selected ? "ProseMirror-selectednode" : ""}`} contentEditable={false}>
    {src ? <ImageWithLoadState key={src} src={src} alt={alt}/> : <div role="img" aria-label={alt ? `Could not load ${alt}` : "Could not load image"} className="my-3 grid min-h-40 w-full max-w-3xl place-items-center rounded-xl bg-slate-100 px-4 text-center text-sm text-red-600">This image has no saved file reference. Edit the note and upload a replacement.</div>}
  </NodeViewWrapper>;
}
