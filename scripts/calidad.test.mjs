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

// MSF-895: el guard de arquitectura cruzaba 0 módulos y daba «ok» (verde falso). Estos casos fijan
// que el check FALLA cuando la herramienta no revisó nada, y que sólo da «ok» si realmente cruzó el front.
const guardarDepcruiseFalso = (cwd, { modulos, violaciones = [], codigo = 0 }) => {
  const dir = path.join(cwd, "node_modules", ".bin");
  fs.mkdirSync(dir, { recursive: true });
  const salida = JSON.stringify({
    summary: {
      violations: violaciones,
      error: violaciones.filter((v) => v.rule?.severity === "error").length,
      warn: violaciones.filter((v) => v.rule?.severity === "warn").length,
      totalCruised: modulos,
      totalDependenciesCruised: 0,
    },
  });
  fs.writeFileSync(path.join(dir, "depcruise"), `#!/bin/sh\nprintf '%s' '${salida}'\nexit ${codigo}\n`, { mode: 0o755 });
};

test("[MSF-895] el guard de arquitectura falla si dependency-cruiser no cruzó ningún módulo", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-arch-"));
  guardarDepcruiseFalso(cwd, { modulos: 0 });
  const r = spawnSync(process.execPath, [script, "--only=arch"], { cwd, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /no cruzó ningún módulo/);
});

test("[MSF-895] el guard de arquitectura falla si falta el binario local (no se revisó nada)", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-arch-"));
  const r = spawnSync(process.execPath, [script, "--only=arch"], { cwd, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /falta el binario local de dependency-cruiser/);
});

test("[MSF-895] el guard de arquitectura da ok sólo si cruzó módulos y no encontró violaciones", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-arch-"));
  guardarDepcruiseFalso(cwd, { modulos: 885 });
  const ok = spawnSync(process.execPath, [script, "--only=arch"], { cwd, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /dependency-cruiser \(arquitectura\): ok/);

  guardarDepcruiseFalso(cwd, {
    modulos: 885,
    codigo: 1,
    violaciones: [{ type: "cycle", from: "a.ts", to: "b.ts", rule: { severity: "error", name: "no-circular" } }],
  });
  const conCiclo = spawnSync(process.execPath, [script, "--only=arch"], { cwd, encoding: "utf8" });
  assert.equal(conCiclo.status, 1, conCiclo.stdout);
  assert.match(conCiclo.stdout, /no-circular: a\.ts → b\.ts/);
});
