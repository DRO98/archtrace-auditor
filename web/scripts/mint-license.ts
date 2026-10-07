/**
 * Emite una licencia Pro firmada: `PRO_LICENSE_SECRET=… npm run license:mint -- cliente@correo.com [días]`.
 * El secreto debe ser el mismo que el del servidor que valida (`/api/license`). Sin días, la licencia no caduca.
 */
import { signLicense } from "../src/features/billing/license";

const [sub, days] = process.argv.slice(2);
const secret = process.env.PRO_LICENSE_SECRET;

if (!sub || !secret) {
  console.error("Uso: PRO_LICENSE_SECRET=<secreto> npm run license:mint -- <email o id> [días]");
  process.exit(1);
}

const exp = days ? Date.now() + Number(days) * 24 * 60 * 60 * 1000 : undefined;
if (days && !Number.isFinite(exp)) {
  console.error(`Días no válidos: ${days}`);
  process.exit(1);
}

void signLicense(exp === undefined ? { sub } : { sub, exp }, secret).then((key) => console.log(key));
