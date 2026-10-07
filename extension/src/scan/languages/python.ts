import type { RawCallSite, RawFile, RawImport, RawSymbol } from "../types.js";
import { clip, collapse, firstDocLine, lineCountOf, nodeRange, type SyntaxNode } from "../span.js";

function signatureOf(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName("body");
  const end = body ? body.startIndex : node.endIndex;
  return clip(source.slice(node.startIndex, end).replace(/:\s*$/, ""), 160);
}

function pythonDoc(body: SyntaxNode | null): string | undefined {
  const first = body?.firstNamedChild;
  if (!first || first.type !== "expression_statement") return undefined;
  const expr = first.firstNamedChild;
  if (!expr || expr.type !== "string") return undefined;
  return firstDocLine(expr.text);
}

function definitionOf(node: SyntaxNode): SyntaxNode {
  if (node.type !== "decorated_definition") return node;
  return node.childForFieldName("definition") ?? node.namedChildren[node.namedChildren.length - 1] ?? node;
}

function pushSymbol(symbols: RawSymbol[], node: SyntaxNode, source: string, parent?: RawSymbol): void {
  const defined = definitionOf(node);
  const nameNode = defined.childForFieldName("name");
  const name = nameNode?.text ?? "";
  if (!name) return;
  const kind = defined.type === "class_definition" ? "class" : parent ? "method" : "function";
  const qualifiedName = parent ? `${parent.name}.${name}` : name;
  const symbol: RawSymbol = {
    kind,
    name,
    qualifiedName,
    range: nodeRange(node),
    signature: signatureOf(defined, source),
  };
  if (parent) symbol.parentQualifiedName = parent.qualifiedName;
  const doc = pythonDoc(defined.childForFieldName("body"));
  if (doc) symbol.doc = doc;
  symbols.push(symbol);
  if (kind === "class") {
    const body = defined.childForFieldName("body");
    for (const child of body?.namedChildren ?? []) {
      const inner = definitionOf(child);
      if (inner.type === "function_definition") pushSymbol(symbols, child, source, symbol);
    }
  }
}

function receiverOf(objectNode: SyntaxNode): "self" | string {
  if (objectNode.type === "identifier" && (objectNode.text === "self" || objectNode.text === "cls")) {
    return "self";
  }
  return collapse(objectNode.text);
}

function callSite(node: SyntaxNode, symbols: readonly RawSymbol[]): RawCallSite | null {
  const target = node.childForFieldName("function");
  if (!target) return null;
  let name = "";
  let receiver: "self" | string | null = null;
  if (target.type === "identifier") name = target.text;
  else if (target.type === "attribute") {
    name = target.childForFieldName("attribute")?.text ?? "";
    const objectNode = target.childForFieldName("object");
    receiver = objectNode ? receiverOf(objectNode) : null;
  } else return null;
  if (!name) return null;
  const range = nodeRange(node);
  let enclosing: string | null = null;
  let span = Number.POSITIVE_INFINITY;
  for (const symbol of symbols) {
    const width = symbol.range.endLine - symbol.range.startLine;
    if (range.startLine >= symbol.range.startLine && range.endLine <= symbol.range.endLine && width < span) {
      enclosing = symbol.qualifiedName;
      span = width;
    }
  }
  return { name, receiver, isNew: false, range, enclosing };
}

function importOf(node: SyntaxNode): RawImport | null {
  if (node.type === "import_statement") {
    const name = node.childForFieldName("name") ?? node.namedChildren[0];
    if (!name) return null;
    return { specifier: collapse(name.text), level: 0 };
  }
  if (node.type !== "import_from_statement") return null;
  const relative = node.children.find((child) => child.type === "relative_import");
  const prefix = relative?.children.find((child) => child.type === "import_prefix" || child.type === "dot");
  const dots = (relative?.text.match(/^\.+/)?.[0] ?? prefix?.text ?? "").length;
  const moduleName =
    node.childForFieldName("module_name") ??
    relative?.namedChildren.find((child) => child.type === "dotted_name" || child.type === "identifier");
  return { specifier: moduleName ? collapse(moduleName.text) : "", level: dots };
}

export function extractPython(tree: { rootNode: SyntaxNode }, source: string): RawFile {
  const symbols: RawSymbol[] = [];
  const imports: RawImport[] = [];
  for (const child of tree.rootNode.namedChildren) {
    const defined = definitionOf(child);
    if (defined.type === "class_definition" || defined.type === "function_definition") {
      pushSymbol(symbols, child, source);
    }
    const imported = importOf(child);
    if (imported && (imported.specifier.length > 0 || imported.level > 0)) imports.push(imported);
  }
  const callSites = tree.rootNode
    .descendantsOfType("call")
    .map((node) => callSite(node, symbols))
    .filter((site): site is RawCallSite => site !== null);
  const moduleDoc = pythonDoc(tree.rootNode);
  return {
    language: "python",
    lineCount: lineCountOf(source),
    ...(moduleDoc ? { doc: moduleDoc } : {}),
    imports,
    symbols,
    callSites,
  };
}
