import { memo } from "react";
import { ArrowRight, Code2 } from "lucide-react";
import type { CodeSubBlock, ModuleRole } from "@core/graph";
import { cn } from "@/lib/cn";
import { describeSubBlock } from "@/features/canvas/lib/describe";
import { useCanvasStore } from "@/features/canvas/store";
import { syncEditorTo } from "@/features/canvas/lib/useEditorSync";
import { KIND_ICON } from "./kindIcons";
import { dataFlowOf, signatureOf } from "./lib/blockSignature";

interface SubBlockRowProps {
  moduleId: string;
  filePath: string;
  language: string;
  role: ModuleRole;
  block: CodeSubBlock;
  siblings: readonly CodeSubBlock[];
}

const ACTION =
  "inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-teal-500";

function SubBlockRowComponent({ moduleId, filePath, language, role, block, siblings }: SubBlockRowProps) {
  const selected = useCanvasStore((state) => state.selectedSubBlockId === block.id);
  const matched = useCanvasStore((state) => state.match?.subBlocks.has(block.id) === true);
  const active = useCanvasStore((state) => state.activeSubBlockId === block.id);
  const Icon = KIND_ICON[block.kind];
  const indented = block.kind === "method";
  const description = describeSubBlock(block, siblings);
  const signature = signatureOf(block, language);
  const flow = dataFlowOf(block, role);
  const tone = active
    ? "bg-emerald-50 ring-1 ring-inset ring-emerald-500"
    : selected
      ? "bg-teal-50/60"
      : matched
        ? "bg-sky-50"
        : "hover:bg-slate-50";

  const goToCode = () => {
    useCanvasStore.getState().selectSubBlock(moduleId, block.id);
    syncEditorTo({ filePath, line: block.range.startLine, endLine: block.range.endLine }, { allowDeepLink: true });
  };

  return (
    <div
      data-subblock={block.id}
      className={cn("group flex items-start gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-b-0", indented && "pl-8", tone)}
    >
      <Icon className="mt-1 size-3.5 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <code title={signature} className="min-w-0 truncate font-mono text-[12.5px] font-semibold text-slate-900">
            {signature}
          </code>
          <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-400">L{block.range.startLine}</span>
        </div>
        <p className="mt-0.5 text-xs leading-4 text-slate-500">{description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {flow ? (
            <span
              title="Dirección de datos inferida del nombre y del rol del módulo"
              className="inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] font-medium text-slate-600"
            >
              <span className="text-slate-400">Entrada</span>
              <span className="truncate text-slate-800">{flow.input}</span>
              <ArrowRight className="size-3 shrink-0 text-slate-400" aria-hidden />
              <span className="text-slate-400">Salida</span>
              <span className="truncate text-slate-800">{flow.output}</span>
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 gap-1 opacity-70 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" onClick={goToCode} title={`Ir a ${filePath}:${block.range.startLine}`} className={ACTION}>
              <Code2 className="size-3" aria-hidden />
              code
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export const SubBlockRow = memo(SubBlockRowComponent);
