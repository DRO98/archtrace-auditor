"use client";

import { useTeacherConnection } from "@/hooks/useTeacherSocket";

/** Mantiene abierto el puente WebSocket con el IDE mientras se navega por el dashboard. */
export function TeacherConnection() {
  useTeacherConnection();
  return null;
}
