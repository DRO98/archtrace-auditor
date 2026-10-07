/**
 * Idioma de las superficies que ya son bilingües (Architecture Check, brief de cambio). No hay i18n completa:
 * el resto del lienzo sigue en español. Se decide por el idioma del navegador; en el servidor, español.
 */
export type UiLanguage = "es" | "en";

export function languageFrom(tag: string | null | undefined): UiLanguage {
  return tag?.toLowerCase().startsWith("es") ? "es" : "en";
}

export function uiLanguage(): UiLanguage {
  return typeof navigator === "undefined" ? "es" : languageFrom(navigator.language);
}
