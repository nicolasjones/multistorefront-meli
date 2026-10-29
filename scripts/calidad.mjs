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
// Escribe `reports/calidad.md` y devuelve exit != 0 si algún check falló (el workflow lo puede
// mantener como NO bloqueante al principio: `continue-on-error: true`).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const only = (argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const skipDocker = argv.includes("--no-docker");
const wants = (name) => (!only.length || only.includes(name));

function run(cmd, args, { input = null } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error && r.error.code === "ENOENT") return { missing: true, code: 127, out: "" };
  return { missing: false, code: r.status ?? 1, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}
const have = (cmd) => !run(cmd, ["--version"]).missing;

const cwd = process.cwd();
const rows = [];
function add(name, res, { hint = "" } = {}) {
  const status = res.missing ? "saltado" : res.code === 0 ? "ok" : "hallazgos";
  rows.push({ name, status, out: res.out, hint });
  console.log(`\n== ${name}: ${status}${res.missing ? " (herramienta no disponible)" : ""}`);
  if (!res.missing && res.out) console.log(res.out.split("\n").slice(-40).join("\n"));
}

const docker = !skipDocker && have("docker");
const pnpm = have("pnpm");

// 1) secretos — BINARIO si está; docker sólo como fallback. (En CI el `-v` de Docker con runner
// containerizado puede NO ver el workspace y escanear 0 bytes => falso verde; el binario lo evita.)
if (wants("secrets")) {
  const glCfg = fs.existsSync(path.join(cwd, ".gitleaks.toml")) ? ["--config", ".gitleaks.toml"] : [];
  const args = ["detect", "--source", ".", "--no-git", "--redact", ...glCfg];
  add("gitleaks (secretos)", have("gitleaks")
    ? run("gitleaks", args)
    : docker
      ? run("docker", ["run", "--rm", "-v", `${cwd}:/src`, "-w", "/src", "ghcr.io/gitleaks/gitleaks:latest", ...args])
      : { missing: true, code: 127, out: "" },
    { hint: "binario nativo / docker" });
}

// 2) SAST (oxlint: reglas de seguridad de alto valor, sin docker/pip; corre en el runner)
if (wants("sast") && pnpm) {
  add("oxlint (SAST)", run("pnpm", ["dlx", "oxlint@1.79.0",
    "-D", "no-eval", "-D", "no-new-func", "-D", "no-implied-eval", "-D", "no-script-url",
    "apps", "packages", "supabase/functions"]),
    { hint: "reglas de seguridad de oxlint" });
}

// 3) código muerto
if (wants("deadcode") && pnpm) add("knip (código muerto)", run("pnpm", ["dlx", "knip", "--no-progress"]));

// 4) duplicación
if (wants("dup") && pnpm) add("jscpd (duplicación)", run("pnpm", ["dlx", "jscpd", "--config", ".jscpd.json"]));

// 5) arquitectura / ciclos
if (wants("arch") && pnpm) add("dependency-cruiser (arquitectura)", run("pnpm", ["dlx", "depcruise", "--config", ".dependency-cruiser.cjs", "apps/web/src", "packages"]));

// 6) deps coherentes entre workspaces
if (wants("deps") && pnpm) add("syncpack (versiones)", run("pnpm", ["dlx", "syncpack@13", "list-mismatches"]));

// 7) mensajes de commit (conventional) — sólo si el runner pasa el rango (PR)
if (wants("commits") && pnpm && process.env.COMMITLINT_FROM && process.env.COMMITLINT_TO) {
  add("commitlint (mensajes)", run("pnpm", ["dlx", "@commitlint/cli",
    "--from", process.env.COMMITLINT_FROM, "--to", process.env.COMMITLINT_TO]));
}

// ---- resumen ----
const fallos = rows.filter((r) => r.status === "hallazgos");
const dir = path.join(cwd, "reports");
try { fs.mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
const md = [
  `# Calidad determinista — ${new Date().toISOString().slice(0, 10)}`,
  ``,
  `| check | estado |`,
  `|---|---|`,
  ...rows.map((r) => `| ${r.name} | ${r.status} |`),
  ``,
].join("\n");
try { fs.writeFileSync(path.join(dir, "calidad.md"), md); } catch { /* best-effort */ }

console.log(`\n---- RESUMEN ----`);
for (const r of rows) console.log(`  ${r.status.padEnd(10)} ${r.name}`);
if (fallos.length) { console.log(`\n${fallos.length} check(s) con hallazgos.`); process.exit(1); }
console.log(`\nTodo OK.`);
