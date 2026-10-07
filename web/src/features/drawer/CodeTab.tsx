"use client";

import type { CodeModule } from "@core/graph";
import { inferRole } from "@/features/canvas/lib/architecture";
import { ConnectionsList } from "./ConnectionsList";
import { orderSubBlocks } from "./lib/orderSubBlocks";
import { SubBlockRow } from "./SubBlockRow";

export function CodeTab({ module: codeModule }: { module: CodeModule }) {
  const blocks = orderSubBlocks(codeModule.subBlocks);
  const role = codeModule.role ?? inferRole(codeModule);

  return (
    <div className="flex min-h-full flex-col">
      <section className="px-4 pt-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Bloques de código <span className="font-normal text-slate-400">({blocks.length})</span>
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">Cada función con lo que recibe y lo que devuelve.</p>
        {blocks.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
            Este archivo no tiene funciones ni clases detectadas.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {blocks.map((block) => (
              <SubBlockRow
                key={block.id}
                moduleId={codeModule.id}
                filePath={codeModule.filePath}
                language={codeModule.language}
                role={role}
                block={block}
                siblings={codeModule.subBlocks}
              />
            ))}
          </div>
        )}
      </section>
      <ConnectionsList module={codeModule} />
    </div>
  );
}
