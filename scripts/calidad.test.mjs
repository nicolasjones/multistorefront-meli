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

// MSF-843: el hallazgo de un check que falla tiene que llegar completo al log del CI y al informe,
// aun con salida larga (mayor que los recortes de 40 y 60 líneas y que el buffer del pipe).
function correrConPnpmFalso(ruidoKb) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-"));
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "pnpm"), `#!/usr/bin/env node
if (process.argv.includes("--version")) { console.log("11.19.0"); process.exit(0); }
console.log("HALLAZGO-INICIAL");
for (let i = 0; i < ${ruidoKb}; i++) console.log("x".repeat(1024));
for (let i = 0; i < 70; i++) console.log("ruido " + i);
console.log("HALLAZGO-FINAL");
process.exitCode = 1;
`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [script, "--only=deadcode"], {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  return { r, md: fs.readFileSync(path.join(cwd, "reports", "calidad.md"), "utf8") };
}

test("[MSF-843] el log del CI y el informe traen la salida completa del check que falló", () => {
  const { r, md } = correrConPnpmFalso(200);
  assert.equal(r.status, 1);
  for (const marca of ["HALLAZGO-INICIAL", "HALLAZGO-FINAL"]) {
    assert.ok(r.stdout.includes(marca), `stdout sin ${marca}`);
    assert.ok(md.includes(marca), `calidad.md sin ${marca}`);
  }
  assert.match(r.stdout, /---- RESUMEN ----/);
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

// MSF-895: la regla `not-to-dev-dep` sólo vigila algo si la herramienta CLASIFICA las dependencias npm.
// Con `node_modules` en `exclude` la arista hacia el paquete se borra y la regla nunca dispara: otro
// verde falso. Este caso corre el binario real sobre un fixture con la forma del front.
test("[MSF-895] la regla not-to-dev-dep marca un devDependency usado por código de runtime y lo deja pasar en los tests", (t) => {
  const binario = path.resolve("node_modules/.bin/depcruise");
  if (!fs.existsSync(binario)) return t.skip("dependency-cruiser no está instalado");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-regla-"));
  const escribir = (rel, contenido) => {
    fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), contenido);
  };
  escribir("apps/web/package.json", JSON.stringify({ name: "web", devDependencies: { "paquete-de-prueba": "1.0.0" } }));
  escribir("apps/web/node_modules/paquete-de-prueba/package.json", JSON.stringify({ name: "paquete-de-prueba", version: "1.0.0", main: "index.js" }));
  escribir("apps/web/node_modules/paquete-de-prueba/index.js", "module.exports = 1;\n");
  escribir("apps/web/src/arranque.ts", "import { x } from 'paquete-de-prueba'\nexport const y = x\n");
  escribir("apps/web/src/arranque.test.ts", "import { x } from 'paquete-de-prueba'\nexport const y = x\n");

  const r = spawnSync(binario, ["--config", path.resolve(".dependency-cruiser.cjs"), "--output-type", "json", "apps/web/src"], { cwd, encoding: "utf8" });
  const salida = JSON.parse(r.stdout || "{}");
  const violaciones = (salida.summary?.violations || []).filter((v) => v.rule?.name === "not-to-dev-dep");
  assert.equal(violaciones.length, 1, `esperaba 1 violación de not-to-dev-dep y hubo ${violaciones.length}: ${JSON.stringify(salida.summary?.violations)}`);
  assert.match(violaciones[0].from, /arranque\.ts$/, "la violación tiene que señalar el archivo de runtime");
  assert.doesNotMatch(violaciones[0].from, /\.test\.ts$/, "un test puede usar devDependencies: no es una violación");
});
