"use client";

import type { FlowStep } from "@core/simulation";
import { formatPayload } from "../lib/payload";

const CODE_BLOCK =
  "w-full max-h-28 overflow-y-auto overflow-x-auto whitespace-pre rounded-md bg-slate-900 px-2.5 py-2 font-mono text-[11px] leading-4 text-slate-100 [scrollbar-color:#475569_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-transparent";

function PayloadBlock({ title, value }: { title: string; value: FlowStep["mockPayload"]["input"] }) {
  return (
    <section className="w-full">
      <h4 className="mb-1 text-[11px] font-medium text-slate-500">{title}</h4>
      <pre className={CODE_BLOCK}>{formatPayload(value)}</pre>
    </section>
  );
}

/** Dato que entra y dato que sale de un paso. Son ejemplos ilustrativos, no capturas de una ejecución real. */
export function PayloadPair({ payload }: { payload: FlowStep["mockPayload"] }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <PayloadBlock title="Payload de entrada" value={payload.input} />
      <PayloadBlock title="Payload de salida" value={payload.output} />
      <p className="text-[11px] leading-4 text-slate-400">
        Datos de ejemplo para ilustrar el recorrido; no proceden de una ejecución real.
      </p>
    </div>
  );
}
