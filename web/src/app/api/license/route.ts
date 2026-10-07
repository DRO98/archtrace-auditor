import { licenseKind, verifySignedLicense } from "@/features/billing/license";

export const runtime = "nodejs";

const STRIPE_TIMEOUT_MS = 8_000;

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/** ¿La sesión de Checkout está pagada? Solo lectura en Stripe; aquí no se guarda nada (ni repos ni clientes). */
async function stripeSessionPaid(sessionId: string, secretKey: string): Promise<boolean | null> {
  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (response.status === 404) return false;
    if (!response.ok) return null;
    const session = (await response.json()) as { status?: string; payment_status?: string };
    return session.status === "complete" && (session.payment_status === "paid" || session.payment_status === "no_payment_required");
  } catch {
    return null;
  }
}

/**
 * Valida una licencia Pro (ver `features/billing/license.ts`). El cliente guarda el resultado en `localStorage`;
 * este endpoint no tiene estado ni ve código ni repos.
 */
export async function POST(request: Request): Promise<Response> {
  let key = "";
  try {
    const body = (await request.json()) as { key?: unknown };
    key = typeof body.key === "string" ? body.key.trim() : "";
  } catch {
    // Cuerpo inválido: se trata como clave vacía.
  }
  const kind = licenseKind(key);
  if (!kind) return fail(400, "Invalid license format.");

  if (kind === "signed") {
    const secret = process.env.PRO_LICENSE_SECRET;
    if (!secret) return fail(503, "License verification is not configured on this server.");
    const check = await verifySignedLicense(key, secret);
    if (!check.ok) return fail(403, check.reason === "expired" ? "This license has expired." : "This license is not valid.");
    return Response.json({ ok: true, kind, sub: check.payload.sub, exp: check.payload.exp ?? null });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return fail(503, "Stripe verification is not configured on this server.");
  const paid = await stripeSessionPaid(key, stripeKey);
  if (paid === null) return fail(502, "Could not reach Stripe. Try again in a minute.");
  if (!paid) return fail(403, "This checkout session is not paid.");
  return Response.json({ ok: true, kind, sub: key, exp: null });
}
