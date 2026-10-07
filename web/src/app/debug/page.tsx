"use client";

import { useState } from "react";
import { BridgeTestPanel } from "@/components/BridgeTestPanel";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { StepTimeline, type TimelineStep } from "@/features/drawer/StepTimeline";
import { useTeacherConnection } from "@/hooks/useTeacherSocket";

const DEMO_STEPS: readonly TimelineStep[] = [
  {
    stepNumber: 1,
    title: "Recibir la pregunta",
    summary: "La API recibe el texto y lo entrega al pipeline.",
    connectionReason: "pasa el texto al recuperador.",
    locationLabel: "src/api/routes.py · L12–28",
  },
  {
    stepNumber: 2,
    title: "Buscar fragmentos",
    summary: "El almacén vectorial compara la consulta con los documentos.",
    connectionReason: "devuelve los tres fragmentos más cercanos.",
    locationLabel: "src/rag/vector_store.py · L56–68",
  },
  {
    stepNumber: 3,
    title: "Construir el prompt",
    summary: "Los fragmentos se insertan en la plantilla del modelo.",
    connectionReason: "el prompt listo va al servicio de lenguaje.",
    locationLabel: "src/llm/prompts.py · L8–22",
  },
  {
    stepNumber: 4,
    title: "Redactar la respuesta",
    summary: "El modelo genera la respuesta a partir del contexto.",
    connectionReason: "cierra el recorrido y devuelve el texto.",
    locationLabel: "src/llm/service.py · L30–48",
  },
];

function TimelineDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Demo de StepTimeline</h2>
      <StepTimeline
        steps={DEMO_STEPS}
        activeIndex={activeIndex}
        onPrev={() => setActiveIndex((index) => Math.max(0, index - 1))}
        onNext={() => setActiveIndex((index) => Math.min(DEMO_STEPS.length - 1, index + 1))}
        onOpenInIde={(index) => console.info("abrir paso", index)}
      />
    </section>
  );
}

export default function DebugPage() {
  useTeacherConnection();

  return (
    <main className="mx-auto flex h-dvh max-w-lg flex-col gap-8 overflow-y-auto bg-canvas px-6 py-16">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">ArchTrace</h1>
        <ConnectionBadge />
      </header>
      <BridgeTestPanel />
      <TimelineDemo />
    </main>
  );
}
