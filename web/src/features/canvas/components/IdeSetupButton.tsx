"use client";

import { Settings2 } from "lucide-react";
import { ideOption, shortenPath } from "../lib/ideSetup";
import { useIdeSetup } from "../lib/useIdeSetup";

type IdeSetupButtonProps = {
  /** En el dock con IDE conectado: solo icono para no duplicar texto. */
  variant?: "full" | "icon";
};

export function IdeSetupButton({ variant = "full" }: IdeSetupButtonProps) {
  const { setup, setOpen } = useIdeSetup();
  const option = setup ? ideOption(setup.ide) : null;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Configurar IDE y carpeta del proyecto"
        aria-label="Configurar IDE y carpeta del proyecto"
        className="inline-flex shrink-0 items-center rounded p-0.5 text-ink-2 hover:bg-neutral-100 hover:text-ink"
      >
        <Settings2 className="size-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex min-w-0 items-center gap-1.5 font-sans text-ink hover:underline"
    >
      {option ? (
        <>
          <span className="grid h-4 min-w-4 place-items-center rounded bg-neutral-100 px-0.5 font-mono text-[9px] font-semibold">
            {option.mark}
          </span>
          <span className="truncate">
            {option.id === "jetbrains" ? "JetBrains" : option.label} · {shortenPath(setup?.projectRoot ?? "")}
          </span>
        </>
      ) : (
        "Configurar IDE"
      )}
    </button>
  );
}
