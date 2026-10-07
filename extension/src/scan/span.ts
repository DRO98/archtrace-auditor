import type { LineRange } from "@core/protocol";
import type Parser from "web-tree-sitter";

export type SyntaxNode = Parser.SyntaxNode;

export function lineCountOf(source: string): number {
  if (source.length === 0) return 0;
  const lines = source.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function clip(text: string, max: number): string {
  const clean = collapse(text);
  return clean.length <= max ? clean : clean.slice(0, max);
}

export function nodeRange(node: SyntaxNode): LineRange {
  const startLine = node.startPosition.row + 1;
  let endLine = node.endPosition.row + 1;
  if (node.endPosition.column === 0 && endLine > startLine) endLine -= 1;
  return { startLine, endLine };
}

export function contains(outer: LineRange, inner: LineRange): boolean {
  return inner.startLine >= outer.startLine && inner.endLine <= outer.endLine;
}

export function firstDocLine(raw: string): string | undefined {
  const body = raw
    .replace(/^[\s\S]*?"""/, "")
    .replace(/"""[\s\S]*$/, "")
    .replace(/^[\s\S]*?'''/, "")
    .replace(/'''[\s\S]*$/, "");
  const source = raw.includes('"""') || raw.includes("'''") ? body : raw;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return clip(trimmed, 160);
  }
  return undefined;
}
