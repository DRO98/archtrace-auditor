import type { FlowStep } from "@core/simulation";
import { formatPayload } from "../lib/payload";

function PayloadBlock({ title, value }: { title: string; value: FlowStep["mockPayload"]["input"] }) {
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h4>
      {/* Siempre como texto (nunca HTML): el contenido viene de un archivo editable. */}
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-neutral-50 p-2 font-mono text-xs leading-5 text-ink-2">
        {formatPayload(value)}
      </pre>
    </section>
  );
}

/** Dato que entra y dato que sale de un paso. Son ejemplos ilustrativos, no capturas de una ejecución real. */
export function PayloadPair({ payload }: { payload: FlowStep["mockPayload"] }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <PayloadBlock title="Entra" value={payload.input} />
      <PayloadBlock title="Sale" value={payload.output} />
      <p className="text-[11px] leading-4 text-ink-3">
        Datos de ejemplo para ilustrar el recorrido; no proceden de una ejecución real.
      </p>
    </div>
  );
}
