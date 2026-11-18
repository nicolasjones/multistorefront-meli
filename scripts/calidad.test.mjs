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

// Lo que knip habría reportado en el `quality` de MSF-843: una dependencia que el paquete
// que la importa no declara. Sale como texto legible, no como anotación `::warning`.
const HALLAZGO_FALSO = "pg  apps/web/e2e/ventas-impresion.e2e.ts:88:130";
// Salida larga: el hallazgo va al principio y después hay ruido. Así el log del CI y el informe
// sólo lo muestran si la salida se imprime COMPLETA —si se recorta a las últimas líneas, el
// hallazgo se pierde y el rojo vuelve a quedar sin diagnóstico. El ruido tiene que ser MÁS largo
// que los dos recortes que hay que vigilar (40 líneas en la consola, 60 en el informe): si no,
// el test pasa aunque el recorte vuelva.
const RUIDO = Array.from({ length: 70 }, (_, i) => `línea de ruido ${i + 1}`);

// Corre `scripts/calidad.mjs` con un `pnpm` falso en el PATH: el shim contesta `--version`
// (para que la herramienta esté disponible) y, en el `pnpm dlx knip@…` que dispara el check
// de código muerto, imprime el hallazgo de knip y sale con código 1. También dice si el hijo
// heredó GITHUB_ACTIONS: con esa variable knip y oxlint cambian de formato y escriben
// anotaciones `::warning`/`::error` en vez de texto, así que el log del CI deja de decir qué
// encontraron — fue justo lo que dejó el `quality` de MSF-843 rojo sin diagnóstico.
function correrCalidadConPnpmFalso() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-"));
  const bin = path.join(cwd, "bin");
  fs.mkdirSync(bin);
  const shim = path.join(bin, "pnpm");
  fs.writeFileSync(
    shim,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("11.19.0"); process.exit(0); }
console.log("GHA=" + (process.env.GITHUB_ACTIONS === undefined ? "<unset>" : process.env.GITHUB_ACTIONS));
console.log("Unlisted dependencies (1)");
console.log(${JSON.stringify(HALLAZGO_FALSO)});
for (const l of ${JSON.stringify(RUIDO)}) console.log(l);
process.exit(1);
`,
  );
  fs.chmodSync(shim, 0o755);
  const r = spawnSync(process.execPath, [script, "--only=deadcode"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_ACTIONS: "1" },
  });
  const leer = (nombre) => {
    const archivo = path.join(cwd, "reports", nombre);
    return fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "";
  };
  return { r, md: leer("calidad.md"), log: leer("calidad.log") };
}

test("[MSF-843] el informe de calidad dice qué encontró el check que falló", () => {
  const { r, md, log } = correrCalidadConPnpmFalso();
  assert.equal(r.status, 1, r.stdout);
  assert.match(md, /## knip \(código muerto\)/, "reports/calidad.md tiene que tener la sección del check que falló");
  assert.ok(md.includes(HALLAZGO_FALSO), "reports/calidad.md tiene que traer el hallazgo del check que falló");
  assert.ok(log.includes(HALLAZGO_FALSO), "reports/calidad.log tiene que traer el hallazgo del check que falló");
  // El log del paso del CI (stdout) es lo primero que se lee en el PR: si deja de decir qué
  // encontró —o lo recorta— el rojo vuelve a ser indiagnosticable aunque los artifacts traigan
  // la salida.
  assert.ok(r.stdout.includes(HALLAZGO_FALSO), "el log del CI tiene que decir qué encontró el check que falló");
});

test("[MSF-843] las herramientas no heredan GITHUB_ACTIONS (si lo heredan, el log del CI no dice qué encontraron)", () => {
  const { log } = correrCalidadConPnpmFalso();
  assert.match(log, /GHA=<unset>/, "el hijo de scripts/calidad.mjs tiene que correr sin GITHUB_ACTIONS");
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
