import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Imagen Docker ligera: solo el servidor + ficheros trazados (incluye `@core/*`).
  output: "standalone",
  // Monorepo: traza imports de `../core/src` hacia la raíz del repo.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Rutas anteriores del dashboard: los enlaces guardados siguen funcionando.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/dashboard/pipelines", permanent: false },
      { source: "/dashboard/knowledge", destination: "/dashboard/pipelines", permanent: false },
      { source: "/dashboard/knowledge-base", destination: "/dashboard/pipelines", permanent: false },
      { source: "/dashboard/api", destination: "/dashboard/api-keys", permanent: false },
    ];
  },
};

export default nextConfig;
