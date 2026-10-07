"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Layers, ScanSearch, ShieldCheck } from "lucide-react";
import { FREE_FEATURES, PRO_FEATURES, PRO_PERIOD, PRO_PRICE } from "@/features/billing/plans";
import { PROJECT_GRAPH, pipelineHref } from "@/features/canvas/lib/graphName";
import { BrandMark, PRODUCT_NAME } from "@/features/dashboard/BrandMark";
import { DASHBOARD_ROUTES } from "@/features/dashboard/routes";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, GithubMark } from "@/features/dashboard/ui";
import { sharedDataFromHash } from "@/features/share/lib/shareState";
import { parseRepoRef } from "@/lib/github/client";
import { cn } from "@/lib/cn";

const EXAMPLES = ["fastapi/full-stack-fastapi-template", "vercel/commerce", "gin-gonic/gin"] as const;

const PILLARS = [
  {
    icon: Layers,
    title: "See the architecture, not the files",
    body: "A 4–8 block map of the whole repo in seconds. Drill into any block down to modules and code.",
  },
  {
    icon: ScanSearch,
    title: "Architecture Check",
    body: "Circular dependencies, god nodes, layer inversions and drift between the map and the code — anchored to real modules.",
  },
  {
    icon: FileText,
    title: "Change briefs for Cursor",
    body: "Pick a module, describe the change, copy a prompt scoped to its blast radius. Your agent stays inside the lines.",
  },
] as const;

/**
 * Entrada pública en inglés: promesa + pegar un repo. El análisis ocurre en el navegador (`/dashboard/pipelines?repo=`).
 * Los enlaces compartidos antiguos (`/#data=…`) no llegan al servidor: se reenvían aquí al editor.
 */
export function Landing() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sharedDataFromHash(window.location.hash)) router.replace(`${pipelineHref(PROJECT_GRAPH)}${window.location.hash}`);
  }, [router]);

  function open(input: string): void {
    if (!parseRepoRef(input)) {
      setError("Use owner/repo, owner/repo@branch or a GitHub URL.");
      return;
    }
    setError(null);
    router.push(`${DASHBOARD_ROUTES.pipelines}?repo=${encodeURIComponent(input.trim())}`);
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    open(value);
  }

  return (
    <div lang="en" className="theme-light h-dvh overflow-y-auto bg-app text-fg">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BrandMark className="size-6 text-brand" />
          {PRODUCT_NAME}
        </span>
        <Link href={DASHBOARD_ROUTES.pipelines} className="text-sm text-fg-2 hover:text-fg">
          Open the app →
        </Link>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-16 px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <section aria-labelledby="hero-title" className="flex flex-col items-center gap-6 text-center">
          <h1 id="hero-title" className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Understand any AI-generated repo in 60 seconds
          </h1>
          <p className="max-w-2xl text-pretty text-base text-fg-2 sm:text-lg">
            Paste a GitHub repo and get a living architecture map, a check of what&apos;s structurally wrong, and scoped prompts to change it safely.
          </p>
          <form onSubmit={onSubmit} className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">GitHub repository</span>
              <GithubMark className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="owner/repo or https://github.com/owner/repo"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                className={cn(FIELD, "h-11 w-full pl-9 font-mono text-sm")}
              />
            </label>
            <button type="submit" disabled={value.trim() === ""} className={cn(BTN_PRIMARY, "h-11 px-5")}>
              Map it
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </form>
          {error ? (
            <p role="alert" className="-mt-3 text-sm text-rose-600">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-fg-3">
            <span>Try:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => open(example)}
                className="rounded-md border border-edge bg-panel px-2 py-1 font-mono text-fg-2 hover:border-brand/50 hover:text-fg"
              >
                {example}
              </button>
            ))}
            <span aria-hidden>·</span>
            <Link href={DASHBOARD_ROUTES.pipelines} className="underline underline-offset-2 hover:text-fg">
              or browse the demos
            </Link>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-fg-3">
            <ShieldCheck className="size-3.5 text-live" aria-hidden />
            Runs in your browser. Your code never touches our servers. No account needed.
          </p>
        </section>

        <section aria-label="What you get" className="grid gap-4 md:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-xl border border-edge bg-panel p-5">
              <span className="grid size-9 place-items-center rounded-lg border border-brand/30 bg-brand/10 text-brand-soft" aria-hidden>
                <Icon className="size-4" />
              </span>
              <h2 className="mt-4 text-[15px] font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-fg-2">{body}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="pricing-title" className="flex flex-col gap-4">
          <h2 id="pricing-title" className="text-center text-xl font-semibold">
            Simple pricing. Bring your own AI key.
          </h2>
          <div className="mx-auto grid w-full max-w-3xl gap-4 md:grid-cols-2">
            <PriceCard name="Free" price="€0" period="/forever" features={FREE_FEATURES} />
            <PriceCard name="Pro" price={PRO_PRICE} period={PRO_PERIOD} features={PRO_FEATURES} featured />
          </div>
          <div className="flex justify-center">
            <Link href={DASHBOARD_ROUTES.pipelines} className={BTN_SECONDARY}>
              Start free
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

function PriceCard({ name, price, period, features, featured = false }: { name: string; price: string; period: string; features: readonly string[]; featured?: boolean }) {
  return (
    <article className={cn("flex flex-col rounded-xl border bg-panel p-5", featured ? "border-brand/60 bg-gradient-to-b from-brand/10 to-panel" : "border-edge")}>
      <h3 className="text-sm font-semibold">{name}</h3>
      <p className="mt-3 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">{price}</span>
        <span className="text-sm text-fg-3">{period}</span>
      </p>
      <ul className="mt-4 flex flex-col gap-1.5 border-t border-edge pt-4 text-sm text-fg-2">
        {features.map((feature) => (
          <li key={feature}>· {feature}</li>
        ))}
      </ul>
    </article>
  );
}
