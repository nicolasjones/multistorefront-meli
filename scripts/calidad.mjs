#!/usr/bin/env node
// F1 — Calidad DETERMINISTA del producto (sin LLM).
// Corre, best-effort, los checks que no dependen del criterio de una persona/agente:
//   - secretos ......... gitleaks (docker)
//   - SAST ............. semgrep  (docker)
//   - código muerto .... knip     (pnpm dlx)
//   - duplicación ...... jscpd    (pnpm dlx)
//   - ciclos/arquitectura dependency-cruiser (pnpm dlx)
//   - deps coherentes .. syncpack (pnpm dlx)
// Objetivo: que el DESARROLLADOR los corra ANTES de pedir review y que el REVISOR cita esta evidencia
// (menos ida y vuelta). Si una herramienta no está disponible, se SALTE A con aviso (no rompe el flujo).
//
// Uso:  pnpm calidad            # todo
//       pnpm calidad --code     # sólo código (sin docker)
//       node scripts/calidad.mjs --only secrets,sast
//
// Escribe `reports/calidad.md` (resumen) y `reports/calidad.log` (salida COMPLETA de cada herramienta) y
// devuelve exit != 0 si algún check falló. Un error de una herramienta (excepción, timeout, buffer)
// queda como `hallazgos` con su causa y se llega al bloque `---- RESUMEN ----`. Un error del propio script
// (uncaughtException/unhandledRejection) sale con exit 1 dejando la causa en consola y en `reports/calidad.log`.
// Si el workflow bloquea o no el merge lo decide el ruleset de GitHub (ver docs/calidad.md), no este script.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const skipDocker = argv.includes("--no-docker");
const wants = (name) => (!only.length || only.includes(name));

// Las herramientas corren sin anotaciones de GitHub Actions (`::warning`) ni color: oxlint cambia de
// formato con GITHUB_ACTIONS=1 y la salida del hijo se vuelve ruidosa y difícil de diagnosticar.
const childEnv = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: process.env.CI || "1" };
delete childEnv.GITHUB_ACTIONS;
const TIMEOUT_MS = 10 * 60 * 1000;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: childEnv, timeout: TIMEOUT_MS });
  if (r.error && r.error.code === "ENOENT") return { missing: true, code: 127, out: "" };
  let out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.error) out += `\n[calidad] error del proceso hijo: ${r.error.code || ""} ${r.error.message}`;
  if (r.signal) out += `\n[calidad] terminado por señal ${r.signal}`;
  return { missing: false, code: r.status ?? 1, out: out.trim() };
}
const have = (cmd) => !run(cmd, ["--version"]).missing;

const cwd = process.cwd();
const rows = [];
const dir = path.join(cwd, "reports");
const logPath = path.join(dir, "calidad.log");
try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(logPath, ""); } catch { /* best-effort */ }
const log = (txt) => { try { fs.appendFileSync(logPath, `${txt}\n`); } catch { /* best-effort */ } };

// Ejecuta un check; si algo lanza, queda registrado como hallazgo con su causa (nunca mata el proceso).
function check(name, fn, opts) {
  let res;
  try { res = fn(); } catch (e) { res = { missing: false, code: 1, out: `[calidad] excepción en el check: ${e?.stack || e}` }; }
  add(name, res, opts);
}
function add(name, res, { hint = "" } = {}) {
  log(`\n===== ${name} (código ${res.code}) =====\n${res.out}`);
  const status = res.missing ? "saltado" : res.code === 0 ? "ok" : "hallazgos";
  rows.push({ name, status, out: res.out, hint });
  console.log(`\n== ${name}: ${status}${res.missing ? " (herramienta no disponible)" : ""}`);
  if (!res.missing && res.out) console.log(res.out.split("\n").slice(-40).join("\n"));
}

// Red de seguridad: cualquier error inesperado se informa con su causa y sale por el mismo camino (exit 1).
process.stdout.on("error", () => { /* EPIPE al cerrar el pipe del runner: no es un fallo de calidad */ });
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (e) => {
    const msg = `[calidad] ${ev}: ${e?.stack || e}`;
    try { console.error(msg); log(msg); } catch { /* nada más que hacer */ }
    process.exit(1);
  });
}

const docker = !skipDocker && have("docker");
const pnpm = have("pnpm");


// 1) secretos — BINARIO si está; docker sólo como fallback. (En CI el `-v` de Docker con runner
// containerizado puede NO ver el workspace y escanear 0 bytes => falso verde; el binario lo evita.)
if (wants("secrets")) {
  const glCfg = fs.existsSync(path.join(cwd, ".gitleaks.toml")) ? ["--config", ".gitleaks.toml"] : [];
  const args = ["detect", "--source", ".", "--no-git", "--redact", ...glCfg];
  check("gitleaks (secretos)", () => have("gitleaks")
    ? run("gitleaks", args)
    : docker
      ? run("docker", ["run", "--rm", "-v", `${cwd}:/src`, "-w", "/src", "ghcr.io/gitleaks/gitleaks:latest", ...args])
      : { missing: true, code: 127, out: "" },
    { hint: "binario nativo / docker" });
}

// 2) SAST (oxlint: reglas de seguridad de alto valor, sin docker/pip; corre en el runner)
if (wants("sast") && pnpm) {
  check("oxlint (SAST)", () => run("pnpm", ["dlx", "oxlint@1.79.0", "--format=default",
    "-D", "no-eval", "-D", "no-new-func", "-D", "no-implied-eval", "-D", "no-script-url",
    "apps", "packages", "supabase/functions"]),
    { hint: "reglas de seguridad de oxlint" });
}

// 3) código muerto
if (wants("deadcode") && pnpm) check("knip (código muerto)", () => run("pnpm", ["dlx", "knip", "--no-progress"]));

// 4) duplicación
if (wants("dup") && pnpm) check("jscpd (duplicación)", () => run("pnpm", ["dlx", "jscpd", "--config", ".jscpd.json"]));

// 5) arquitectura / ciclos
if (wants("arch") && pnpm) check("dependency-cruiser (arquitectura)", () => run("pnpm", ["dlx", "depcruise", "--config", ".dependency-cruiser.cjs", "apps/web/src", "packages"]));

// 6) deps coherentes entre workspaces
if (wants("deps") && pnpm) check("syncpack (versiones)", () => run("pnpm", ["dlx", "syncpack@13", "list-mismatches"]));

// 7) mensajes de commit (conventional) — sólo si el runner pasa el rango (PR)
if (wants("commits") && pnpm && process.env.COMMITLINT_FROM && process.env.COMMITLINT_TO) {
  check("commitlint (mensajes)", () => run("pnpm", ["dlx", "@commitlint/cli",
    "--from", process.env.COMMITLINT_FROM, "--to", process.env.COMMITLINT_TO]));
}

// ---- resumen ----
const fallos = rows.filter((r) => r.status === "hallazgos");
const md = [
  `# Calidad determinista — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `| check | estado |`,
  `|---|---|`,
  ...rows.map((r) => `| ${r.name} | ${r.status} |`),
  ``,
  ...fallos.flatMap((r) => [`## ${r.name}`, "", "```", r.out.split("\n").slice(-60).join("\n"), "```", ""]),
  `Salida completa de cada herramienta: \`reports/calidad.log\` (artifact \`calidad-reporte\`).`,
  ``,
].join("\n");
try { fs.writeFileSync(path.join(dir, "calidad.md"), md); } catch { /* best-effort */ }

console.log(`\n---- RESUMEN ----`);
for (const r of rows) console.log(`  ${r.status.padEnd(10)} ${r.name}`);
if (fallos.length) { console.log(`\n${fallos.length} check(s) con hallazgos.`); process.exit(1); }
console.log(`\nTodo OK.`);
