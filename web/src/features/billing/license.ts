/**
 * Licencias Pro sin base de datos. Dos formatos válidos:
 * - Clave firmada `ATP1.<payload>.<firma>`: HMAC-SHA256 (base64url) de `<payload>` con `PRO_LICENSE_SECRET`.
 *   Se emiten con `npm run license:mint -- <email>`; el payload es `{ sub, exp? }` en base64url.
 * - Sesión de Stripe Checkout `cs_…`: el Payment Link redirige a `/?license={CHECKOUT_SESSION_ID}` y el servidor
 *   comprueba contra la API de Stripe que está pagada (`STRIPE_SECRET_KEY`).
 * La verificación va SIEMPRE en el servidor (`/api/license`): un prefijo público en el cliente se falsifica sin esfuerzo.
 * Solo usa Web Crypto, así que funciona igual en Node (tests, route handler) y en el navegador.
 */

export const LICENSE_PREFIX = "ATP1";
const encoder = new TextEncoder();

export interface LicensePayload {
  /** A quién se emitió (email o id del pedido). */
  sub: string;
  /** Caducidad en ms desde epoch; sin ella, no caduca. */
  exp?: number;
}

export type LicenseKind = "signed" | "stripe";

export function licenseKind(key: string): LicenseKind | null {
  const trimmed = key.trim();
  if (/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(trimmed)) return "stripe";
  if (/^ATP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return "signed";
  return null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

/** Comparación en tiempo constante para no filtrar la firma por tiempos de respuesta. */
function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

export async function signLicense(payload: LicensePayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${LICENSE_PREFIX}.${body}.${await hmac(secret, body)}`;
}

export type LicenseCheck = { ok: true; payload: LicensePayload } | { ok: false; reason: "format" | "signature" | "expired" };

export async function verifySignedLicense(key: string, secret: string, now = Date.now()): Promise<LicenseCheck> {
  const [prefix, body, signature] = key.trim().split(".");
  if (prefix !== LICENSE_PREFIX || !body || !signature) return { ok: false, reason: "format" };
  if (!sameText(await hmac(secret, body), signature)) return { ok: false, reason: "signature" };
  let payload: LicensePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as LicensePayload;
  } catch {
    return { ok: false, reason: "format" };
  }
  if (typeof payload.sub !== "string") return { ok: false, reason: "format" };
  if (typeof payload.exp === "number" && payload.exp < now) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
