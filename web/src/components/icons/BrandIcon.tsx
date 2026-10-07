import type { SimpleIcon } from "simple-icons";
import { cn } from "@/lib/cn";

/**
 * Logo oficial de simple-icons (SVG 24×24). Por defecto usa el color de marca;
 * pasa `className` con `text-*` y `colored={false}` para heredar `currentColor`.
 */
export function BrandIcon({
  icon,
  className,
  colored = true,
}: {
  icon: Pick<SimpleIcon, "path" | "hex">;
  className?: string;
  colored?: boolean;
}) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
      fill={colored ? `#${icon.hex}` : "currentColor"}
    >
      <path d={icon.path} />
    </svg>
  );
}
