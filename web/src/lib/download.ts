/**
 * Descarga en el navegador. El enlace se inserta en el DOM (Firefox ignora `click()` en enlaces sueltos)
 * y la URL del blob se revoca después del clic, no en el mismo tick: revocarla antes corta la descarga en Safari/Firefox.
 */
export function downloadUrl(filename: string, href: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadText(filename: string, text: string, mimeType = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
  downloadUrl(filename, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
