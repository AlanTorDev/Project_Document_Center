import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DocumentImageNodeView } from "./image-node-view";

declare module "@tiptap/extension-image" {
  interface SetImageOptions {
    storagePath?: string | null;
  }
}

export const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      storagePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-storage-path"),
        renderHTML: (attributes) => attributes.storagePath ? { "data-storage-path": attributes.storagePath } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(DocumentImageNodeView);
  },
});
