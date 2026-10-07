import type { Metadata } from "next";
import { Landing } from "@/features/landing/Landing";

export const metadata: Metadata = {
  title: "ArchTrace — Understand any AI-generated repo in 60 seconds",
  description: "Paste a GitHub repo: architecture map, Architecture Check and scoped prompts for Cursor. Runs in your browser.",
};

/** Landing del tutor visual (heredada): fuera de la navegación principal, accesible por URL. */
export default function WelcomePage() {
  return <Landing />;
}
