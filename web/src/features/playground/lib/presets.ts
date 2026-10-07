/**
 * Consultas de ejemplo del playground: cada una rellena pregunta y documento con un caso que el
 * pipeline RAG didáctico resuelve bien (texto con secciones claras y palabras que la pregunta repite,
 * porque el embedder es una bolsa de palabras).
 */
export type PlaygroundPresetIcon = "file-text" | "code";

export interface PlaygroundPreset {
  id: string;
  /** Icono Lucide del chip (sin emojis). */
  icon: PlaygroundPresetIcon;
  label: string;
  question: string;
  documentName: string;
  documentText: string;
}

const RAG_GUIDE = `# Cómo funciona un pipeline RAG

La generación aumentada por recuperación (RAG) combina un buscador con un modelo de lenguaje.
En lugar de confiar solo en lo que el modelo memorizó, el sistema busca primero fragmentos
relevantes de tus documentos y se los entrega al modelo como contexto.

## 1. Troceado (chunking)
El documento se divide en ventanas de texto de tamaño fijo, por ejemplo 240 caracteres.
Las ventanas se solapan unos 40 caracteres: así una idea que cae en la frontera entre dos
fragmentos no se pierde, porque aparece completa en al menos uno de ellos.

## 2. Embeddings
Cada fragmento se convierte en un vector numérico. Textos con palabras parecidas producen
vectores cercanos. En este playground el embedder es una bolsa de palabras hasheada a 32
dimensiones: no entiende sinónimos, pero es transparente y determinista.

## 3. Vector store
Los vectores se guardan en un índice en memoria. Para responder, la pregunta también se
convierte en vector y se buscan los fragmentos con mayor similitud coseno (top-k).

## 4. Generación
Los fragmentos recuperados se pegan en el prompt junto a la pregunta. El LLM responde usando
solo ese contexto, lo que reduce las alucinaciones y permite citar la fuente.

## Costes
Cada llamada al LLM consume tokens de entrada (prompt + contexto) y de salida (respuesta).
Recuperar menos fragmentos, o más cortos, abarata la consulta pero puede dejar fuera información.
`;

const PYTHON_SCRIPT = `"""limpiar_ventas.py — normaliza el CSV de ventas antes de cargarlo en el panel."""
import csv
from datetime import datetime
from pathlib import Path

ENTRADA = Path("datos/ventas_brutas.csv")
SALIDA = Path("datos/ventas_limpias.csv")
FORMATOS_FECHA = ("%d/%m/%Y", "%Y-%m-%d")


def parsear_fecha(texto):
    """Prueba cada formato de FORMATOS_FECHA y devuelve la fecha en ISO; None si ninguno encaja."""
    for formato in FORMATOS_FECHA:
        try:
            return datetime.strptime(texto.strip(), formato).date().isoformat()
        except ValueError:
            continue
    return None


def limpiar_importe(texto):
    """Quita el símbolo de euro y los separadores de miles; la coma decimal pasa a punto."""
    limpio = texto.replace("€", "").replace(".", "").replace(",", ".").strip()
    return round(float(limpio), 2) if limpio else 0.0


def main():
    filas_validas, descartadas = [], 0
    with ENTRADA.open(encoding="utf-8") as origen:
        for fila in csv.DictReader(origen):
            fecha = parsear_fecha(fila["fecha"])
            if fecha is None:
                descartadas += 1  # fila sin fecha legible: se descarta
                continue
            filas_validas.append({
                "fecha": fecha,
                "cliente": fila["cliente"].strip().title(),
                "importe": limpiar_importe(fila["importe"]),
            })

    with SALIDA.open("w", newline="", encoding="utf-8") as destino:
        escritor = csv.DictWriter(destino, fieldnames=["fecha", "cliente", "importe"])
        escritor.writeheader()
        escritor.writerows(filas_validas)

    print(f"{len(filas_validas)} filas limpias, {descartadas} descartadas")


if __name__ == "__main__":
    main()
`;

export const PLAYGROUND_PRESETS: readonly PlaygroundPreset[] = [
  {
    id: "summary",
    icon: "file-text",
    label: "Resumen de Documento",
    question: "Resume en tres puntos cómo funciona el pipeline RAG y qué papel tiene el troceado.",
    documentName: "guia-rag.md",
    documentText: RAG_GUIDE,
  },
  {
    id: "python",
    icon: "code",
    label: "Explicar Script Python",
    question: "¿Qué hace este script y qué pasa con las filas cuya fecha no se puede parsear?",
    documentName: "limpiar_ventas.py",
    documentText: PYTHON_SCRIPT,
  },
];
