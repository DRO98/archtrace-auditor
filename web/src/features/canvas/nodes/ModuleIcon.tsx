import { Settings } from "lucide-react";
import type { ModuleRole } from "@core/graph";
import { ROLE_ICON, isConfigModule } from "../theme";

/** Icono por categoría; los módulos de configuración usan engranaje en lugar de cohete. */
export function ModuleIcon({ role, filePath, className }: { role: ModuleRole; filePath: string; className?: string }) {
  if (isConfigModule(role, filePath)) return <Settings className={className} aria-hidden />;
  const Icon = ROLE_ICON[role];
  return <Icon className={className} aria-hidden />;
}
