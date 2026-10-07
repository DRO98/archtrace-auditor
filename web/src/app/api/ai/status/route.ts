import { describeProvider, readSelection } from "@/lib/ai";
import { envKeyStatus } from "@/lib/ai/env";

export const runtime = "nodejs";

/** Proveedor del `.env` más qué claves de servidor existen (solo booleanos, nunca el valor). */
export function GET(): Response {
  return Response.json({ ...describeProvider(), envKeys: envKeyStatus() });
}

/** Resuelve qué proveedor y modelo usará la app con la selección del navegador (o el `.env` si no basta). */
export async function POST(request: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Sin cuerpo: se describe el `.env`.
  }
  const ai = typeof body === "object" && body !== null && "ai" in body ? body.ai : null;
  return Response.json(describeProvider(readSelection(ai)));
}
