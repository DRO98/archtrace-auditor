#!/usr/bin/env node
// Lanzador: ejecuta la CLI TypeScript con tsx y el tsconfig del auditor (aliases @core/@scanner/@llm),
// sea cual sea el directorio desde el que se invoque.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const cli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const result = spawnSync(
  process.execPath,
  [cli, "--tsconfig", path.join(root, "tsconfig.json"), path.join(root, "src", "cli", "main.ts"), ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
