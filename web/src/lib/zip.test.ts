import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { crc32, createZip, dataUrlToBytes } from "./zip";

test("crc32 coincide con el valor de referencia", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("createZip: estructura válida (firmas, número de entradas y offsets)", () => {
  const zip = createZip([
    { name: "ARCHITECTURE.md", data: "# Arquitectura\n", date: new Date(2026, 8, 27, 10, 0, 0) },
    { name: "img/diagrama.png", data: new Uint8Array([137, 80, 78, 71]) },
  ]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
});

test("createZip: lo descomprime una herramienta estándar (si hay python)", (context) => {
  const dir = mkdtempSync(path.join(tmpdir(), "tc-zip-"));
  try {
    const file = path.join(dir, "docs.zip");
    writeFileSync(file, createZip([{ name: "ARCHITECTURE.md", data: "# Arquitectura · ñ\n" }, { name: "a/b.mmd", data: "graph TD\n" }]));
    try {
      execFileSync("python", ["--version"], { stdio: "ignore" });
    } catch {
      return context.skip("python no disponible");
    }
    const output = execFileSync(
      "python",
      ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('|'.join(z.namelist()));print(z.read('ARCHITECTURE.md').decode())", file],
      { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    assert.match(output, /ARCHITECTURE\.md\|a\/b\.mmd/);
    assert.match(output, /Arquitectura · ñ/);
    assert.ok(readFileSync(file).length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dataUrlToBytes: base64 y texto codificado", () => {
  assert.deepEqual([...dataUrlToBytes("data:image/png;base64,iVBORw==")], [137, 80, 78, 71]);
  assert.equal(new TextDecoder().decode(dataUrlToBytes("data:image/svg+xml;charset=utf-8,%3Csvg%3E")), "<svg>");
});
