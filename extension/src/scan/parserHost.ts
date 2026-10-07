import path from "node:path";
import Parser from "web-tree-sitter";
import type { MapLanguage } from "@core/projectMap";
import { extractPython } from "./languages/python.js";
import { extractTypeScript } from "./languages/typescript.js";
import type { RawFile } from "./types.js";

export type GrammarName = "python" | "javascript" | "typescript" | "tsx";

const GRAMMAR_FILE: Record<GrammarName, string> = {
  python: "tree-sitter-python.wasm",
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
};

export function grammarFor(filename: string): { grammar: GrammarName; language: MapLanguage; jsx: boolean } | null {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".py") return { grammar: "python", language: "python", jsx: false };
  if (ext === ".ts" || ext === ".tsx" || ext === ".jsx") {
    return {
      grammar: "tsx",
      language: ext === ".jsx" ? "javascript" : "typescript",
      jsx: ext !== ".ts",
    };
  }
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { grammar: "javascript", language: "javascript", jsx: false };
  return null;
}

export interface ParserHost {
  parse(language: MapLanguage, filename: string, text: string): Promise<RawFile>;
  dispose(): void;
}

export async function createParserHost(wasmDir: string): Promise<ParserHost> {
  await Parser.init({
    locateFile(scriptName: string) {
      return path.join(wasmDir, scriptName);
    },
  });
  const parser = new Parser();
  const languages = new Map<GrammarName, Parser.Language>();

  async function language(name: GrammarName): Promise<Parser.Language> {
    const cached = languages.get(name);
    if (cached) return cached;
    const loaded = await Parser.Language.load(path.join(wasmDir, GRAMMAR_FILE[name]));
    languages.set(name, loaded);
    return loaded;
  }

  return {
    async parse(_language: MapLanguage, filename: string, text: string): Promise<RawFile> {
      const kind = grammarFor(filename);
      if (!kind) throw new Error(`Unsupported file: ${filename}`);
      const lang = await language(kind.grammar);
      parser.setLanguage(lang);
      const tree = parser.parse(text);
      try {
        if (kind.grammar === "python") return extractPython(tree, text);
        const raw = extractTypeScript(tree, text, kind.jsx);
        raw.language = kind.language;
        return raw;
      } finally {
        tree.delete();
      }
    },
    dispose() {
      parser.delete();
      languages.clear();
    },
  };
}
