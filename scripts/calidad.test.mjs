import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve("scripts/calidad.mjs");

test("[MSF-683] calidad llega al RESUMEN y deja reports/calidad.log aunque no corra ninguna herramienta", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-"));
  const r = spawnSync(process.execPath, [script, "--only=ninguno"], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /---- RESUMEN ----/);
  assert.ok(fs.existsSync(path.join(cwd, "reports", "calidad.log")));
  assert.ok(fs.existsSync(path.join(cwd, "reports", "calidad.md")));
});

// MSF-929: el store local de pnpm no pone rojo el escaneo de secretos, pero el código del repo se sigue escaneando completo.
test("[MSF-929] .gitleaks.toml excluye el store/cachés de dependencias y no debilita el escaneo del código", (t) => {
  if (spawnSync("gitleaks", ["version"], { encoding: "utf8" }).status !== 0) return t.skip("gitleaks no está instalado");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-"));
  const falso = `const aws_access_key_id = "AKIA${"IOSFODNN7EXAMPL3"}"\naws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY12"\n`;
  const escribir = (rel) => { fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), falso); };
  const escanear = () => spawnSync("gitleaks", ["detect", "--source", ".", "--no-git", "--redact", "--config", path.resolve(".gitleaks.toml"), "--report-format", "json", "--report-path", "-"], { cwd, encoding: "utf8" });
  const archivos = (r) => JSON.parse(r.stdout || "[]").map((h) => h.File);

  for (const rel of [".pnpm-store/v3/files/x.js", "node_modules/p/x.js", ".local/share/pnpm/store/y.js"]) escribir(rel);
  assert.deepEqual(archivos(escanear()), [], "las carpetas de dependencias no se escanean");

  escribir("apps/web/src/secreto.ts");
  const hallazgos = archivos(escanear());
  assert.equal(hallazgos.length >= 1, true, "un secreto en el código del repo sigue detectándose");
  assert.ok(hallazgos.every((f) => f.includes("apps/web/src/secreto.ts")), `solo el código del repo: ${hallazgos.join(", ")}`);
});
