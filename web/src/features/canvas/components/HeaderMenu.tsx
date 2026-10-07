"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { HEADER_BUTTON_ACTIVE, HEADER_BUTTON_SECONDARY } from "../theme";

export interface HeaderMenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Marca el elemento como el actual (p. ej. la demo cargada). */
  current?: boolean;
  onSelect: () => void;
}

interface HeaderMenuProps {
  label: string;
  icon: ReactNode;
  title: string;
  heading?: string;
  items: readonly HeaderMenuItem[];
  align?: "left" | "right";
  /** Resalta el botón (p. ej. mientras hay una demo cargada). */
  highlighted?: boolean;
}

const MENU_WIDTH = 320;

/**
 * Menú desplegable de la cabecera. Se pinta en un portal con posición fija: la cabecera tiene
 * `overflow-x-auto` y recortaría un desplegable absoluto. Teclado: flechas, Inicio/Fin, Escape.
 */
export function HeaderMenu({ label, icon, title, heading, items, align = "left", highlighted = false }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
    const left = align === "left" ? rect.left : rect.right - width;
    setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const focus = (next: number): void => entries[(next + entries.length) % entries.length]?.focus();
    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(entries.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") buttonRef.current?.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={highlighted || open ? HEADER_BUTTON_ACTIVE : HEADER_BUTTON_SECONDARY}
      >
        {icon}
        {label}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={heading ?? label}
              onKeyDown={onMenuKeyDown}
              style={{ top: position.top, left: position.left, width: Math.min(MENU_WIDTH, window.innerWidth - 16) }}
              className="fixed z-[90] overflow-hidden rounded-xl border border-line bg-white p-1 shadow-xl"
            >
              {heading ? <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{heading}</p> : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  aria-current={item.current || undefined}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none"
                >
                  {item.icon ? <span className="mt-0.5 shrink-0 text-ink-2">{item.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{item.label}</span>
                    {item.description ? <span className="block text-xs text-ink-3">{item.description}</span> : null}
                  </span>
                  {item.current ? <Check className="mt-0.5 size-4 shrink-0 text-teal-600" aria-label="Actual" /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
