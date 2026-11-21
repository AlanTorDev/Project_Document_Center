export type DocumentNode = {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> | null }[];
  attrs?: Record<string, unknown> | null;
  content?: DocumentNode[];
};

function inline(node: DocumentNode): string {
  if (node.type === "hardBreak") return "  \n";
  let text = node.text ?? (node.content ?? []).map(inline).join("");
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") text = `**${text}**`;
    if (mark.type === "italic") text = `_${text}_`;
    if (mark.type === "strike") text = `~~${text}~~`;
    if (mark.type === "code") text = `\`${text}\``;
    if (mark.type === "link") text = `[${text}](${String(mark.attrs?.href ?? "")})`;
  }
  return text;
}

export function documentToMarkdown(node: DocumentNode): string {
  const children = node.content ?? [];
  return children.map((child) => {
    const value = (child.content ?? []).map(inline).join("");
    switch (child.type) {
      case "heading": return `${"#".repeat(Number(child.attrs?.level ?? 1))} ${value}`;
      case "bulletList": return (child.content ?? []).map((item) => `- ${(item.content ?? []).map((part) => documentToMarkdown({ content: [part] }).trim()).join("\n  ")}`).join("\n");
      case "orderedList": return (child.content ?? []).map((item, index) => `${index + 1}. ${(item.content ?? []).map((part) => documentToMarkdown({ content: [part] }).trim()).join("\n   ")}`).join("\n");
      case "taskList": return (child.content ?? []).map((item) => `- [${item.attrs?.checked ? "x" : " "}] ${(item.content ?? []).map(inline).join("")}`).join("\n");
      case "blockquote": return (child.content ?? []).map((part) => `> ${documentToMarkdown({ content: [part] }).trim()}`).join("\n");
      case "codeBlock": return `\`\`\`${String(child.attrs?.language ?? "")}\n${value}\n\`\`\``;
      case "horizontalRule": return "---";
      case "image": return `![${String(child.attrs?.alt ?? "")}](${String(child.attrs?.src ?? "")})`;
      case "table": return (child.content ?? []).map((row) => `| ${(row.content ?? []).map((cell) => (cell.content ?? []).map(inline).join("")).join(" | ")} |`).join("\n");
      default: return value;
    }
  }).filter(Boolean).join("\n\n");
}

export function documentToSearchText(node: DocumentNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(documentToSearchText).filter(Boolean).join(" ");
}
