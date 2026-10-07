"use client";

import { useEffect } from "react";

/** Red de seguridad de la ruta: sin ella un error de render deja la pantalla en blanco. */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[teacher] error de render", error);
  }, [error]);

  return (
    <div role="alert" className="flex h-dvh items-center justify-center bg-canvas p-6 text-ink">
      <div className="w-full max-w-xl rounded-xl border border-rose-200 bg-white p-4 shadow-md">
        <h1 className="text-sm font-semibold text-rose-700">Algo falló al mostrar ArchTrace</h1>
        <p className="mt-2 break-words font-mono text-xs text-ink-2">{error.message || "Error desconocido"}</p>
        {error.digest ? <p className="mt-1 font-mono text-[11px] text-ink-3">digest: {error.digest}</p> : null}
        <button
          type="button"
          onClick={() => retry()}
          className="mt-3 h-8 rounded-lg bg-ink px-3 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
