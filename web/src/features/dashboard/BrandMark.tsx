/** Nombre comercial del producto: único punto de verdad para la interfaz. */
export const PRODUCT_NAME = "ArchTrace";

/**
 * Isotipo de ArchTrace: tres nodos de arquitectura unidos por trazos. El nodo de origen (arriba) se
 * ramifica hacia dos servicios, y el trazo inferior cierra el flujo. Usa `currentColor`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M12 7.5 6.6 16.2M12 7.5l5.4 8.7M8.2 18h7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="5.5" r="2.6" fill="currentColor" />
      <circle cx="5.5" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18.5" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
