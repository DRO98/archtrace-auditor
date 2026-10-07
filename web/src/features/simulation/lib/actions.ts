import { useCanvasStore } from "@/features/canvas/store";
import { sendTeacherMessage } from "@/hooks/useTeacherSocket";
import { buildClear } from "@/lib/protocol";
import { useSimStore } from "../store";

/** Botón "Simular flujo": arranca el escenario y abre el panel lateral en la pestaña Flujo. */
export function startSimulation(scenarioId?: string): void {
  const sim = useSimStore.getState();
  const id = scenarioId ?? sim.scenarios[0]?.id;
  if (!id) return;

  const canvas = useCanvasStore.getState();
  canvas.clearImpact(); // el modo impacto y la simulación pintan las mismas aristas: son excluyentes
  canvas.setView("architecture");
  sim.start(id);
  canvas.openDrawer(null, "flow");

  // El foco pasa a "Siguiente paso": si se queda en el botón de la cabecera,
  // Enter o Espacio lo pulsarían de nuevo y pararían la simulación.
  window.requestAnimationFrame(() => document.getElementById("sim-next")?.focus());
}

/** Detiene la simulación y quita el resaltado que dejó en el IDE. */
export function stopSimulation(): void {
  useSimStore.getState().stop();
  sendTeacherMessage(buildClear());
}
