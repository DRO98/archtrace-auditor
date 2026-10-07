"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { CodeModule, EdgeKind } from "@core/graph";
import { cn } from "@/lib/cn";
import { inferRole } from "@/features/canvas/lib/architecture";
import { describeConnection } from "@/features/canvas/lib/describe";
import { useCanvasStore } from "@/features/canvas/store";
import { ModuleIcon } from "@/features/canvas/nodes/ModuleIcon";
import { ROLE_TONE } from "@/features/canvas/theme";

type Direction = "incoming" | "outgoing" | "uses" | "parent";

interface Link {
  id: string;
  kind?: EdgeKind;
  label?: string;
}

function end(item: CodeModule) {
  return { label: item.label, role: item.role ?? inferRole(item) };
}

function explain(self: CodeModule, other: CodeModule, direction: Direction, link: Link): string {
  const options = { kind: link.kind, label: link.label };
  switch (direction) {
    case "incoming":
      return describeConnection(end(other), end(self), options);
    case "outgoing":
      return describeConnection(end(self), end(other), options);
    case "uses":
      return describeConnection(end(self), end(other), { ...options, support: true });
    case "parent":
      return describeConnection(end(other), end(self), { ...options, support: true });
  }
}

interface ItemProps {
  self: CodeModule;
  direction: Direction;
  link: Link;
  open: boolean;
  onToggle: () => void;
}

function ConnectionItem({ self, direction, link, open, onToggle }: ItemProps) {
  const item = useCanvasStore((state) => state.indexes?.modulesById.get(link.id) ?? null);
  if (!item) return null;
  const role = item.role ?? inferRole(item);
  const panelId = `conn-${direction}-${item.id}`;

  return (
    <li className="overflow-hidden rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm text-ink hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", ROLE_TONE[role].tile)} aria-hidden>
          <ModuleIcon role={role} filePath={item.filePath} className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-line bg-neutral-50 px-3 py-2.5">
          <p className="text-sm leading-6 text-ink-2">{explain(self, item, direction, link)}</p>
          <button
            type="button"
            onClick={() => useCanvasStore.getState().openDrawer(item.id, "code")}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"
          >
            Ver {item.label}
            <ArrowRight className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Section({
  title,
  direction,
  links,
  self,
  openKey,
  setOpenKey,
}: {
  title: string;
  direction: Direction;
  links: readonly Link[];
  self: CodeModule;
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}) {
  if (links.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-ink-3">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {links.map((link) => {
          const key = `${direction}:${link.id}`;
          return (
            <ConnectionItem
              key={key}
              self={self}
              direction={direction}
              link={link}
              open={openKey === key}
              onToggle={() => setOpenKey(openKey === key ? null : key)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function unique(links: Link[]): Link[] {
  const seen = new Set<string>();
  return links.filter((link) => (seen.has(link.id) ? false : (seen.add(link.id), true)));
}

export function ConnectionsList({ module: codeModule }: { module: CodeModule }) {
  const graph = useCanvasStore((state) => state.graph);
  const [openState, setOpenState] = useState<{ moduleId: string; key: string | null }>({
    moduleId: codeModule.id,
    key: null,
  });
  const openKey = openState.moduleId === codeModule.id ? openState.key : null;
  const setOpenKey = (key: string | null) => setOpenState({ moduleId: codeModule.id, key });

  const sections = useMemo(() => {
    if (!graph) return { incoming: [] as Link[], outgoing: [] as Link[], uses: [] as Link[], parent: [] as Link[] };
    const incoming = graph.edges
      .filter((edge) => edge.target === codeModule.id)
      .map((edge) => ({ id: edge.source, kind: edge.kind, label: edge.label }));
    const outgoing = graph.edges
      .filter((edge) => edge.source === codeModule.id)
      .map((edge) => ({ id: edge.target, kind: edge.kind, label: edge.label }));
    const uses = graph.modules.filter((item) => item.supportOf === codeModule.id).map((item) => ({ id: item.id }));
    const parent = codeModule.supportOf ? [{ id: codeModule.supportOf }] : [];
    return { incoming: unique(incoming), outgoing: unique(outgoing), uses, parent };
  }, [graph, codeModule]);

  const shared = { self: codeModule, openKey, setOpenKey };
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <Section title="Recibe de" direction="incoming" links={sections.incoming} {...shared} />
      <Section title="Envía a" direction="outgoing" links={sections.outgoing} {...shared} />
      <Section title="Usa" direction="uses" links={sections.uses} {...shared} />
      <Section title="Apoya a" direction="parent" links={sections.parent} {...shared} />
    </div>
  );
}
