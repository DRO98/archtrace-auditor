const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").Plugin} */
const coreAlias = {
  name: "core-alias",
  setup(build) {
    build.onResolve({ filter: /^@core\// }, (args) => ({
      path: path.join(__dirname, "..", "core", "src", `${args.path.slice("@core/".length)}.ts`),
    }));
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
    plugins: [coreAlias],
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
  fs.copyFileSync(
    path.join(__dirname, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
    path.join(target, "tree-sitter.wasm"),
  );
  const grammars = path.join(__dirname, "node_modules", "tree-sitter-wasms", "out");
  for (const name of ["python", "javascript", "tsx"]) {
    fs.copyFileSync(path.join(grammars, `tree-sitter-${name}.wasm`), path.join(target, `tree-sitter-${name}.wasm`));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
