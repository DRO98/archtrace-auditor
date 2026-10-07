const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** `@core/*` y `@scanner/*` → fuentes TS de los paquetes hermanos (sin build propio). */
const ALIASES = { "@core/": path.join(__dirname, "..", "core", "src"), "@scanner/": path.join(__dirname, "..", "scanner", "src") };

/** @type {import("esbuild").Plugin} */
const monorepoAlias = {
  name: "monorepo-alias",
  setup(build) {
    build.onResolve({ filter: /^@(core|scanner)\// }, (args) => {
      const prefix = Object.keys(ALIASES).find((key) => args.path.startsWith(key));
      return { path: path.join(ALIASES[prefix], `${args.path.slice(prefix.length)}.ts`) };
    });
  },
};

async function main() {
  /** @type {import("esbuild").BuildOptions} */
  const options = {
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    external: ["vscode", "bufferutil", "utf-8-validate"],
    minify: production,
    sourcemap: production ? false : true,
    legalComments: production ? "none" : "inline",
    plugins: [monorepoAlias],
    logLevel: "info",
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    return;
  }

  await esbuild.build(options);
  copyWasm();
}

function copyWasm() {
  const target = path.join(__dirname, "dist", "wasm");
  fs.mkdirSync(target, { recursive: true });
  // Mismo `web-tree-sitter` que se empaqueta: el del paquete `scanner/`.
  const modules = path.join(__dirname, "..", "scanner", "node_modules");
  fs.copyFileSync(path.join(modules, "web-tree-sitter", "tree-sitter.wasm"), path.join(target, "tree-sitter.wasm"));
  const grammars = path.join(modules, "tree-sitter-wasms", "out");
  for (const name of ["python", "javascript", "tsx"]) {
    fs.copyFileSync(path.join(grammars, `tree-sitter-${name}.wasm`), path.join(target, `tree-sitter-${name}.wasm`));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
