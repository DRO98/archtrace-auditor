import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "ArchTrace",
  description: "ArchTrace: visualiza, simula y traza la arquitectura de tu software en un lienzo vivo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`h-dvh ${inter.variable} ${jetbrains.variable}`}>
      <body className="h-dvh overflow-hidden bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
