import { SettingsView } from "@/features/dashboard/settings/SettingsView";

/** `?license=<clave o cs_…>` llega de la confirmación del pago (vía `/?license=`) y se activa sola. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ license?: string | string[] }> }) {
  const { license } = await searchParams;
  return <SettingsView initialLicense={typeof license === "string" && license.trim() ? license.trim() : undefined} />;
}
