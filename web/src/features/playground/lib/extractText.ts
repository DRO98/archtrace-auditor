"use client";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_DOCUMENTS = ".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf";

/** Texto de un `.txt`, `.md` o `.pdf`, extraído en el navegador (el archivo no sale del equipo; solo su texto). */
export async function extractDocumentText(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("El archivo pasa de 10 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return extractPdfText(file);
  if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith("text/")) return file.text();
  throw new Error("Formato no soportado: usa .txt, .md o .pdf.");
}

/** pdf.js se carga solo al adjuntar un PDF: pesa demasiado para el arranque del lienzo. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    const text = pages.join("\n\n").trim();
    if (!text) throw new Error("El PDF no tiene texto seleccionable (¿es un escaneo?).");
    return text;
  } finally {
    void task.destroy();
  }
}
