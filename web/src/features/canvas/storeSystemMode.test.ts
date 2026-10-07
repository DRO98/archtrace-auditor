import assert from "node:assert/strict";
import test from "node:test";
import { useCanvasStore } from "./store";

test("P0 · enterSubsystem(null) nunca abre «todos los módulos»: siempre vuelve al mapa", () => {
  const store = useCanvasStore.getState();
  store.setSystemMode(false);
  store.exitToLevel0();
  store.enterSubsystem("svc:api/app.py");
  assert.equal(useCanvasStore.getState().archLevel, 1);

  useCanvasStore.getState().enterSubsystem(null);
  assert.equal(useCanvasStore.getState().archLevel, 0);
  assert.equal(useCanvasStore.getState().focusedSubsystemId, null);

  store.setSystemMode(true);
  useCanvasStore.getState().enterSubsystem("svc:api/app.py");
  assert.equal(useCanvasStore.getState().archLevel, 1);
  useCanvasStore.getState().enterSubsystem(null);
  assert.equal(useCanvasStore.getState().archLevel, 0);
  assert.equal(useCanvasStore.getState().focusedSubsystemId, null);
});

test("P0 · si ya se estaba en «todos los módulos», saber que es sistema devuelve al mapa", () => {
  // Simula estado legado (antes de P0) forzando L1 sin foco vía set interno no disponible:
  // setSystemMode(true) con archLevel 1 + focused null debe salir.
  useCanvasStore.setState({ archLevel: 1, focusedSubsystemId: null, systemMode: false });
  useCanvasStore.getState().setSystemMode(true);
  assert.equal(useCanvasStore.getState().archLevel, 0);
  assert.equal(useCanvasStore.getState().focusedSubsystemId, null);
});

test("Sistema / Arquitectura: el conmutador vive en el nivel superior y volver al mapa lo deja en Sistema", () => {
  const store = useCanvasStore.getState();
  store.setSystemMode(true);
  store.enterSubsystem("svc:api/app.py");
  useCanvasStore.getState().setArchView("architecture");
  assert.equal(useCanvasStore.getState().archView, "architecture");
  assert.equal(useCanvasStore.getState().archLevel, 0, "cambiar de vista sale del servicio abierto");
  useCanvasStore.getState().exitToLevel0();
  assert.equal(useCanvasStore.getState().archView, "system");
  useCanvasStore.getState().setSystemMode(false);
});
