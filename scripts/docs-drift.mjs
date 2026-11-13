#!/usr/bin/env node
// Detecta páginas cuya fuente cambió desde la última actualización de la página.
// Uso: node scripts/docs-drift.mjs [--json]
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestFile = path.join(root, "docs", "manifest.json");
const json = process.argv.includes("--json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const walk = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (["_generated", "diagrams", "node_modules"].includes(e.name)) continue; walk(p, acc); }
    else acc.push(p);
  }
  return acc;
};
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
// Archivos que la fuente tenía cuando se calculó el hash (`sourceAt`). Sumar
// una spec nueva no vuelve vieja a toda página que declara `specs` como
// fuente; lo que cuenta es que cambie o desaparezca algo ya documentado.
function archivosEnCommit(commit, source) {
  if (!commit) return null;
  const existe = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], { cwd: root });
  if (existe.status !== 0) return null;
  const r = spawnSync("git", ["ls-tree", "-r", "--name-only", commit, "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return new Set(r.stdout.split("\n").filter(Boolean));
}

function hashSources(sources = [], sourceAt = null) {
  let files = [];
  for (const s of sources) {
    const p = path.join(root, s);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) files.push(...walk(p)); else files.push(p);
  }
  if (sourceAt) {
    const vigentes = new Set();
    let alcanceConocido = false;
    for (const s of sources) {
      const enCommit = archivosEnCommit(sourceAt, s);
      if (!enCommit) continue;
      alcanceConocido = true;
      for (const f of enCommit) vigentes.add(f);
    }
    if (alcanceConocido) {
      files = files.filter((f) => vigentes.has(rel(f)));
      // Un archivo que existía y ya no está también es un cambio de la fuente.
      for (const f of vigentes) if (!fs.existsSync(path.join(root, f))) files.push(path.join(root, f));
    }
  }
  if (!files.length) return "";
  const sorted = [...new Set(files.map(rel))].sort();
  return sha(
    sorted
      .map((f) => {
        const abs = path.join(root, f);
        return fs.existsSync(abs) ? `${f}:${sha(fs.readFileSync(abs))}` : `${f}:borrado`;
      })
      .join("\n"),
  );
}
if (!fs.existsSync(manifestFile)) { console.error("falta docs/manifest.json (corré docs:manifest)"); process.exit(1); }
const { pages = {} } = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const stale = [];
for (const [page, meta] of Object.entries(pages)) {
  if (!meta.sources?.length) continue;
  const actual = hashSources(meta.sources, meta.sourceAt || null);
  if (meta.sourceHash && actual !== meta.sourceHash) stale.push({ page, sources: meta.sources, desde: meta.commit || "?" });
}
if (json) { console.log(JSON.stringify({ stale }, null, 2)); process.exit(stale.length ? 1 : 0); }
if (!stale.length) { console.log(`Drift: sin páginas desactualizadas (${Object.keys(pages).length} páginas).`); process.exit(0); }
console.error(`Drift: ${stale.length} página(s) con la fuente cambiada:`);
for (const s of stale) console.error(`- ${s.page} (fuentes: ${s.sources.join(", ")}; última: ${s.desde})`);
console.error("Actualizá la página (y regenerá el manifest) antes de mergear.");
process.exit(1);
