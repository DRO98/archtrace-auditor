export const runtime = "nodejs";

export function GET(): Response {
  const projectRoot = process.env.NEXT_PUBLIC_PROJECT_ROOT?.trim();
  if (!projectRoot) {
    return Response.json({ error: "Ruta no configurada" }, { status: 404 });
  }
  return Response.json({ projectRoot });
}
