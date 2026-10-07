import type { RawCallSite, RawFile, RawImport, RawSymbol } from "../types.js";
import { clip, collapse, lineCountOf, nodeRange, type SyntaxNode } from "../span.js";

function signatureOf(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName("body");
  const end = body ? body.startIndex : node.endIndex;
  return clip(source.slice(node.startIndex, end).replace(/=>\s*$/, "").replace(/\{\s*$/, ""), 160);
}

function jsDoc(node: SyntaxNode): string | undefined {
  let cursor = node.previousNamedSibling;
  while (cursor && cursor.type === "comment") {
    const text = cursor.text.trim();
    if (text.startsWith("/**")) {
      const inner = text.replace(/^\/\*\*?/, "").replace(/\*\/$/, "");
      for (const line of inner.split(/\r?\n/)) {
        const trimmed = line.replace(/^\s*\*\s?/, "").trim();
        if (trimmed.length > 0) return clip(trimmed, 160);
      }
    }
    cursor = cursor.previousNamedSibling;
  }
  return undefined;
}

function unwrapExport(node: SyntaxNode): { node: SyntaxNode; rangeNode: SyntaxNode } {
  if (node.type === "export_statement") {
    const inner = node.namedChildren.find((child) => child.type !== "string" && child.type !== "comment") ?? node;
    return { node: inner, rangeNode: node };
  }
  return { node, rangeNode: node };
}

function valueFunction(value: SyntaxNode | null): boolean {
  return value?.type === "arrow_function" || value?.type === "function" || value?.type === "function_expression";
}

function pushFunction(symbols: RawSymbol[], rangeNode: SyntaxNode, name: string, source: string, defined: SyntaxNode): void {
  const symbol: RawSymbol = {
    kind: "function",
    name,
    qualifiedName: name,
    range: nodeRange(rangeNode),
    signature: signatureOf(defined, source),
  };
  const doc = jsDoc(rangeNode);
  if (doc) symbol.doc = doc;
  symbols.push(symbol);
}

function pushClass(symbols: RawSymbol[], rangeNode: SyntaxNode, defined: SyntaxNode, source: string): void {
  const name = defined.childForFieldName("name")?.text ?? "";
  if (!name) return;
  const symbol: RawSymbol = {
    kind: "class",
    name,
    qualifiedName: name,
    range: nodeRange(rangeNode),
    signature: signatureOf(defined, source),
  };
  const doc = jsDoc(rangeNode);
  if (doc) symbol.doc = doc;
  symbols.push(symbol);
  const body = defined.childForFieldName("body");
  for (const child of body?.namedChildren ?? []) {
    if (child.type !== "method_definition" && child.type !== "public_field_definition") continue;
    if (child.type !== "method_definition") continue;
    const methodName = child.childForFieldName("name")?.text ?? "";
    if (!methodName) continue;
    const method: RawSymbol = {
      kind: "method",
      name: methodName,
      qualifiedName: `${name}.${methodName}`,
      parentQualifiedName: name,
      range: nodeRange(child),
      signature: signatureOf(child, source),
    };
    const methodDoc = jsDoc(child);
    if (methodDoc) method.doc = methodDoc;
    symbols.push(method);
  }
}

function collectSymbols(root: SyntaxNode, source: string): RawSymbol[] {
  const symbols: RawSymbol[] = [];
  for (const child of root.namedChildren) {
    if (child.type === "comment") continue;
    const { node, rangeNode } = unwrapExport(child);
    if (node.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text ?? "";
      if (name) pushFunction(symbols, rangeNode, name, source, node);
    } else if (node.type === "class_declaration") {
      pushClass(symbols, rangeNode, node, source);
    } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (const declarator of node.namedChildren) {
        if (declarator.type !== "variable_declarator") continue;
        const value = declarator.childForFieldName("value");
        if (!valueFunction(value) || !value) continue;
        const name = declarator.childForFieldName("name")?.text ?? "";
        if (name) pushFunction(symbols, rangeNode, name, source, declarator);
      }
    }
  }
  return symbols;
}

function callee(node: SyntaxNode): { name: string; receiver: "self" | string | null; isNew: boolean } | null {
  if (node.type === "new_expression") {
    const ctor = node.childForFieldName("constructor") ?? node.namedChildren[0];
    const name = ctor?.type === "identifier" ? ctor.text : "";
    return name ? { name, receiver: null, isNew: true } : null;
  }
  if (node.type !== "call_expression") return null;
  const target = node.childForFieldName("function");
  if (!target) return null;
  if (target.type === "identifier") return { name: target.text, receiver: null, isNew: false };
  if (target.type === "member_expression") {
    const name = target.childForFieldName("property")?.text ?? "";
    const objectNode = target.childForFieldName("object");
    if (!name || !objectNode) return null;
    const receiver = objectNode.type === "this" || objectNode.text === "this" ? "self" : collapse(objectNode.text);
    return { name, receiver, isNew: false };
  }
  return null;
}

function enclosingOf(rangeStart: number, rangeEnd: number, symbols: readonly RawSymbol[]): string | null {
  let enclosing: string | null = null;
  let span = Number.POSITIVE_INFINITY;
  for (const symbol of symbols) {
    const width = symbol.range.endLine - symbol.range.startLine;
    if (rangeStart >= symbol.range.startLine && rangeEnd <= symbol.range.endLine && width < span) {
      enclosing = symbol.qualifiedName;
      span = width;
    }
  }
  return enclosing;
}

function jsxCalls(root: SyntaxNode, symbols: readonly RawSymbol[]): RawCallSite[] {
  const sites: RawCallSite[] = [];
  for (const node of root.descendantsOfType(["jsx_element", "jsx_self_closing_element"])) {
    const open = node.type === "jsx_self_closing_element" ? node : node.namedChildren.find((child) => child.type === "jsx_opening_element");
    const ident = open?.namedChildren.find((child) => child.type === "identifier" || child.type === "jsx_identifier");
    const name = ident?.text ?? "";
    const first = name[0] ?? "";
    if (first === first.toLowerCase()) continue;
    const range = nodeRange(node);
    sites.push({ name, receiver: null, isNew: false, range, enclosing: enclosingOf(range.startLine, range.endLine, symbols) });
  }
  return sites;
}

function importsOf(root: SyntaxNode): RawImport[] {
  const imports: RawImport[] = [];
  for (const child of root.namedChildren) {
    if (child.type !== "import_statement" && child.type !== "export_statement") continue;
    const spec = child.children.find((item) => item.type === "string");
    if (!spec) continue;
    const specifier = spec.text.replace(/^['"]|['"]$/g, "");
    let level = 0;
    if (specifier.startsWith(".")) {
      const ups = specifier.match(/^(?:\.\.\/)+/);
      level = ups ? ups[0].split("../").length - 1 + (specifier.slice(ups[0].length).startsWith("./") ? 1 : 0) : 1;
      if (specifier.startsWith("./")) level = 1;
      else if (specifier.startsWith("../")) level = specifier.split("/").filter((part) => part === "..").length + 1;
    }
    imports.push({ specifier, level });
  }
  return imports;
}

export function extractTypeScript(tree: { rootNode: SyntaxNode }, source: string, _isJsx: boolean): RawFile {
  const symbols = collectSymbols(tree.rootNode, source);
  const callSites: RawCallSite[] = [];
  for (const node of tree.rootNode.descendantsOfType(["call_expression", "new_expression"])) {
    const info = callee(node);
    if (!info) continue;
    const range = nodeRange(node);
    callSites.push({ ...info, range, enclosing: enclosingOf(range.startLine, range.endLine, symbols) });
  }
  callSites.push(...jsxCalls(tree.rootNode, symbols));
  return {
    language: _isJsx ? "typescript" : "javascript",
    lineCount: lineCountOf(source),
    imports: importsOf(tree.rootNode),
    symbols,
    callSites,
  };
}
