"use client";

import { useTeacherStatus } from "@/hooks/useTeacherSocket";
import { cn } from "@/lib/cn";
import type { ConnectionStatus } from "@/lib/ws/TeacherSocketManager";

const LABEL: Record<ConnectionStatus, string> = {
  open: "Online",
  connecting: "Conectando…",
  closed: "Offline",
};

const STYLE: Record<ConnectionStatus, string> = {
  open: "border-emerald-200 bg-emerald-50 text-emerald-700",
  connecting: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-rose-200 bg-rose-50 text-rose-700",
};

const DOT: Record<ConnectionStatus, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-rose-500",
};

/** `quiet`: con conexión sana no pinta nada; solo avisa cuando se conecta o se cae. */
export function ConnectionBadge({ quiet = false }: { quiet?: boolean }) {
  const status = useTeacherStatus();
  if (quiet && status === "open") return null;
  return (
    <p
      role="status"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        STYLE[status],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {LABEL[status]}
    </p>
  );
}
