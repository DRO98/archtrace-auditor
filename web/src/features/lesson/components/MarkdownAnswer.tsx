"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { checkCitation, parseMarkdown, type Inline } from "../lib/markdown";

const CITATION_WARNING: Record<"unknown-file" | "line-out-of-range", string> = {
  "unknown-file": "Esta ruta no aparece en el mapa del proyecto: la IA pudo inventarla.",
  "line-out-of-range": "La línea citada no existe en ese archivo según el mapa del proyecto.",
};

interface MarkdownAnswerProps {
  source: string;
  /** Ruta → nº de líneas del mapa del proyecto; null si aún no se ha cargado (las citas no se marcan). */
  files: ReadonlyMap<string, number> | null;
  /** Transforma los tramos de texto plano (p. ej. para convertir `[1]` en una cita a un fragmento). */
  renderText?: (text: string) => ReactNode;
}

type RenderText = MarkdownAnswerProps["renderText"];

/** Respuesta del mentor en Markdown ligero. Las citas `ruta:línea` abren el IDE y se contrastan con el mapa. */
export function MarkdownAnswer({ source, files, renderText }: MarkdownAnswerProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case "h":
            return (
              <p key={key} className="font-semibold text-ink">
                {renderInlines(block.inlines, files, renderText)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = block.type === "ul" ? "ul" : "ol";
            return (
              <List
                key={key}
                start={block.type === "ol" && block.start !== undefined && block.start !== 1 ? block.start : undefined}
                className={cn("space-y-1 pl-5", block.type === "ul" ? "list-disc" : "list-decimal")}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInlines(item, files, renderText)}</li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded-md bg-neutral-900 px-3 py-2 font-mono text-xs leading-5 text-neutral-100">
                <code>{block.text}</code>
              </pre>
            );
          case "math":
            return (
              <div
                key={key}
                role="math"
                className="overflow-x-auto rounded-lg border border-teal-100 bg-teal-50/50 px-4 py-2.5 text-center font-serif text-[15px] italic leading-7 tracking-wide text-ink"
              >
                {block.lines.map((line, lineIndex) => (
                  <div key={lineIndex} className="whitespace-pre">
                    {line}
                  </div>
                ))}
              </div>
            );
          case "p":
            return <p key={key}>{renderInlines(block.inlines, files, renderText)}</p>;
        }
      })}
    </div>
  );
}

function renderInlines(inlines: readonly Inline[], files: ReadonlyMap<string, number> | null, renderText: RenderText): ReactNode[] {
  return inlines.map((inline, index) => {
    switch (inline.type) {
      case "text":
        return renderText ? <Fragment key={index}>{renderText(inline.text)}</Fragment> : inline.text;
      case "strong":
        return (
          <strong key={index} className="font-semibold text-ink">
            {inline.text}
          </strong>
        );
      case "em":
        return (
          <em key={index} className="italic">
            {inline.text}
          </em>
        );
      case "code":
        return (
          <code key={index} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] text-ink">
            {inline.text}
          </code>
        );
      case "cite":
        return <Citation key={index} cite={inline} files={files} />;
    }
  });
}

function Citation({ cite, files }: { cite: Extract<Inline, { type: "cite" }>; files: ReadonlyMap<string, number> | null }) {
  const check = checkCitation(cite, files);
  if (check === "unknown-file" || check === "line-out-of-range") {
    return (
      <span
        title={CITATION_WARNING[check]}
        className="inline-flex items-center gap-1 rounded bg-amber-50 px-1 py-0.5 font-mono text-[0.85em] text-amber-800 ring-1 ring-inset ring-amber-200"
      >
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        {cite.raw}
        <span className="sr-only"> ({CITATION_WARNING[check]})</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      title="Abrir en el IDE"
      onClick={() => syncEditorTo({ filePath: cite.path, line: cite.line, endLine: cite.endLine ?? undefined }, { allowDeepLink: true })}
      className="rounded bg-sky-50 px-1 py-0.5 font-mono text-[0.85em] text-sky-800 underline-offset-2 ring-1 ring-inset ring-sky-200 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {cite.raw}
    </button>
  );
}
