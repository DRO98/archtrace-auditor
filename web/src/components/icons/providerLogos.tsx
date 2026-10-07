import type { SimpleIcon } from "simple-icons";
import { siAnthropic, siDeepseek, siGooglegemini, siOllama } from "simple-icons";
import type { AiProviderId } from "@/lib/ai/catalog";
import { cn } from "@/lib/cn";

/**
 * Rutas SVG 24×24 de marcas que simple-icons ya no publica (OpenAI) o no incluye (Groq).
 * Origen: isotipos oficiales / antiguos paquetes de iconos de marca.
 */
export const LOCAL_PATHS = {
  openai:
    "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .5157 4.9107 6.051 6.051 0 0 0 6.5116 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0555 6.0555 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.1412.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.1412-.0852-4.783-2.7622a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.052v-5.59a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 7.738a.7948.7948 0 0 0-.3927.6813zm1.0976-4.7057l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
  /** Isotipo Groq (proveedor del catálogo; no Grok/xAI). Fuente: lobe-icons. */
  groq: "M12.036 2c-3.853-.035-7 3-7.036 6.781-.035 3.782 3.055 6.872 6.908 6.907h2.42v-2.566h-2.292c-2.407.028-4.38-1.866-4.408-4.23-.029-2.362 1.901-4.298 4.308-4.326h.1c2.407 0 4.358 1.915 4.365 4.278v6.305c0 2.342-1.944 4.25-4.323 4.279a4.375 4.375 0 01-3.033-1.252l-1.851 1.818A7 7 0 0012.029 22h.092c3.803-.056 6.858-3.083 6.879-6.816v-6.5C18.907 4.963 15.817 2 12.036 2z",
} as const;

type ProviderGlyph = { path: string; hex: string; title: string };

function fromSimple(icon: SimpleIcon): ProviderGlyph {
  return { path: icon.path, hex: icon.hex, title: icon.title };
}

const PROVIDER_GLYPHS: Record<AiProviderId, ProviderGlyph> = {
  openai: { path: LOCAL_PATHS.openai, hex: "412991", title: "OpenAI" },
  anthropic: fromSimple(siAnthropic),
  gemini: fromSimple(siGooglegemini),
  groq: { path: LOCAL_PATHS.groq, hex: "F55036", title: "Groq" },
  deepseek: fromSimple(siDeepseek),
  ollama: fromSimple(siOllama),
};

/** Fondo del tile: marcas oscuras sobre fondo claro (o al revés) para contraste. */
const PROVIDER_TILE: Record<AiProviderId, string> = {
  openai: "bg-zinc-900 text-white",
  anthropic: "bg-[#191919] text-white",
  gemini: "bg-gradient-to-br from-[#4285F4] via-[#9B72CB] to-[#D96570] text-white",
  groq: "bg-[#F55036] text-white",
  deepseek: "bg-[#4d6bfe] text-white",
  ollama: "bg-zinc-100 text-zinc-900 border border-edge-strong",
};

export const PROVIDER_SHORT: Record<AiProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  groq: "Groq",
  deepseek: "DeepSeek",
  ollama: "Ollama / Local",
};

/**
 * Logo oficial del proveedor (SVG 24×24) en un tile cuadrado.
 * Tamaño por defecto ~28px (`size-7`); pasa `className` para `size-6` / `size-8` / `size-10`.
 */
export function ProviderLogo({
  provider,
  className,
  iconClassName,
}: {
  provider: AiProviderId;
  className?: string;
  iconClassName?: string;
}) {
  const glyph = PROVIDER_GLYPHS[provider];
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-lg", PROVIDER_TILE[provider], className)}
      aria-hidden
      title={glyph.title}
    >
      <svg role="img" viewBox="0 0 24 24" className={cn("size-[58%] shrink-0", iconClassName)} fill="currentColor">
        <path d={glyph.path} />
      </svg>
    </span>
  );
}
