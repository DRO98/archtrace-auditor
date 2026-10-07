"use client";

import { DiffEditor, loader, type Monaco, type MonacoDiffEditor } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import type { DiffSide, Finding } from "@core/audit";
import { decorationsFor } from "../lib/review";

// Monaco desde el paquete local copiado a `public/monaco` (scripts/copy-monaco.mjs): nunca el CDN por defecto.
loader.config({ paths: { vs: "/monaco/vs" } });

const OVERVIEW_COLOR: Readonly<Record<Finding["criticality"], string>> = {
  critical: "#e11d48",
  high: "#f59e0b",
  medium: "#0ea5e9",
  low: "#64748b",
  unknown: "#0d9488",
};

export interface DiffViewerProps {
  /** null = el archivo no existe en ese lado (alta o baja). */
  original: string | null;
  modified: string | null;
  language: string;
  /** Identifica los modelos de Monaco (uno por archivo y auditoría). */
  modelKey: string;
  finding: Finding;
  /** Línea a la que saltar (al pulsar una evidencia). */
  focus?: { side: DiffSide; line: number; nonce: number } | null;
}

/** Diff de solo lectura con el rango del hallazgo y sus evidencias resaltados por criticidad. */
export function DiffViewer({ original, modified, language, modelKey, finding, focus }: DiffViewerProps) {
  const editorRef = useRef<MonacoDiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const collections = useRef<{ base?: editor.IEditorDecorationsCollection; head?: editor.IEditorDecorationsCollection }>({});
  const [ready, setReady] = useState(false);

  // Con keepCurrent*Model los modelos sobreviven al cambio de archivo: se liberan todos al salir de la revisión.
  // Diferido: primero tiene que desmontarse el DiffEditor hijo, que suelta sus modelos.
  useEffect(
    () => () => {
      const monaco = monacoRef.current;
      window.setTimeout(() => {
        for (const model of monaco?.editor.getModels() ?? []) {
          if (/^(base|head)\//.test(model.uri.path.replace(/^\//, "")) && !model.isDisposed()) model.dispose();
        }
      }, 0);
    },
    [],
  );

  const paint = useCallback(() => {
    const diff = editorRef.current;
    const monaco = monacoRef.current;
    if (!diff || !monaco) return;
    const sides: Record<DiffSide, editor.IStandaloneCodeEditor> = { base: diff.getOriginalEditor(), head: diff.getModifiedEditor() };
    for (const side of ["base", "head"] as const) {
      const target = sides[side];
      const model = target.getModel();
      const lineCount = model?.getLineCount() ?? 0;
      const decorations = decorationsFor(finding)
        .filter((item) => item.side === side && lineCount > 0)
        .map((item) => ({
          range: new monaco.Range(Math.min(item.startLine, lineCount), 1, Math.min(item.endLine, lineCount), 1),
          options: {
            isWholeLine: true,
            className: item.className,
            ...(item.glyphClassName ? { glyphMarginClassName: item.glyphClassName } : {}),
            hoverMessage: { value: item.hover },
            overviewRuler: { color: OVERVIEW_COLOR[finding.criticality], position: monaco.editor.OverviewRulerLane.Left },
          },
        }));
      collections.current[side]?.clear();
      collections.current[side] = target.createDecorationsCollection(decorations);
    }
    const side = finding.side;
    const line = finding.lines.startLine;
    sides[side].revealLineInCenter(Math.max(1, line));
  }, [finding]);

  // Repintar al cambiar de hallazgo o de contenido (los modelos se sustituyen).
  useEffect(() => {
    if (!ready) return;
    const handle = window.setTimeout(paint, 30);
    return () => window.clearTimeout(handle);
  }, [ready, paint, original, modified]);

  useEffect(() => {
    if (!ready || !focus || !editorRef.current) return;
    const target = focus.side === "base" ? editorRef.current.getOriginalEditor() : editorRef.current.getModifiedEditor();
    target.revealLineInCenter(focus.line);
    target.setPosition({ lineNumber: focus.line, column: 1 });
  }, [ready, focus]);

  return (
    <DiffEditor
      original={original ?? ""}
      modified={modified ?? ""}
      language={language}
      originalModelPath={`base/${modelKey}`}
      modifiedModelPath={`head/${modelKey}`}
      // Sin esto, al cambiar de archivo @monaco-editor/react libera el modelo antes de que el diff lo suelte
      // ("TextModel got disposed before DiffEditorWidget model got reset"). Los modelos se liberan al desmontar.
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      theme="light"
      height="100%"
      loading={<p className="p-4 text-sm text-fg-3">Cargando visor…</p>}
      options={{
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        glyphMargin: true,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderOverviewRuler: true,
        fontSize: 13,
        lineNumbersMinChars: 4,
      }}
      onMount={(diff, monaco) => {
        editorRef.current = diff;
        monacoRef.current = monaco;
        setReady(true);
      }}
    />
  );
}
