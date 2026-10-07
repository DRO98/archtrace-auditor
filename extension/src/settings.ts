import * as vscode from "vscode";

/** Sección de ajustes de la extensión (`archtrace.port`, `archtrace.scan.maxFiles`…). */
export const SETTINGS_SECTION = "archtrace";

/** Sección anterior al cambio de marca (TeacherCanvas): se sigue leyendo si el usuario la tenía configurada. */
export const LEGACY_SETTINGS_SECTION = "teachercanvas";

type Inspection = ReturnType<vscode.WorkspaceConfiguration["inspect"]>;

function isUserSet(inspection: Inspection): boolean {
  return (
    inspection !== undefined &&
    (inspection.globalValue !== undefined || inspection.workspaceValue !== undefined || inspection.workspaceFolderValue !== undefined)
  );
}

/** Clave equivalente en la sección antigua: `archtrace.port` → `teachercanvas.port`. */
export function legacyKey(key: string): string | null {
  const prefix = `${SETTINGS_SECTION}.`;
  return key.startsWith(prefix) ? `${LEGACY_SETTINGS_SECTION}.${key.slice(prefix.length)}` : null;
}

/**
 * Lee `archtrace.*`. Si el usuario no la ha fijado pero sí la clave antigua `teachercanvas.*`, respeta esa
 * (migración sin romper configuraciones existentes); si no, el valor por defecto del manifiesto.
 */
export function readSetting<T>(key: string, fallback: T): T {
  const config = vscode.workspace.getConfiguration();
  if (!isUserSet(config.inspect(key))) {
    const legacy = legacyKey(key);
    if (legacy && isUserSet(config.inspect(legacy))) return config.get<T>(legacy, fallback);
  }
  return config.get<T>(key, fallback);
}

/** Un cambio de configuración que afecta a la extensión (sección nueva o antigua). */
export function affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(SETTINGS_SECTION) || event.affectsConfiguration(LEGACY_SETTINGS_SECTION);
}
