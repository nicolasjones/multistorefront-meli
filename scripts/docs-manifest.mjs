#!/usr/bin/env node
// Genera docs/manifest.json: página, hash, fuentes, hash de fuentes, commit y dueño.
// Si la página NO cambió, conserva el sourceHash anterior (así el drift detecta que la fuente cambió).
// Uso: node scripts/docs-manifest.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const docs = path.join(root, "docs");
const out = path.join(docs, "manifest.json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Último commit propio (sin merges) que tocó `key`: no depende de HEAD, que en el CI es el commit
// efímero de auto-merge del PR. Así `sourceAt` es el mismo en el PR y en su merge (MSF-950).
const ultimoCommit = (key) => (spawnSync("git", ["log", "-1", "--no-merges", "--format=%h", "--", key], { cwd: root, encoding: "utf8" }).stdout || "").trim() || null;
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
function frontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (!m) return { meta, body: txt };
  let key = null;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) { key = kv[1]; const v = kv[2].trim(); meta[key] = v === "[]" ? [] : v; continue; }
    const li = line.match(/^\s*-\s*(.+)$/);
    if (li && key) { if (!Array.isArray(meta[key])) meta[key] = []; meta[key].push(li[1].trim()); }
  }
  return { meta, body: txt.slice(m[0].length) };
}
// Archivos que la fuente tenía en `sourceAt` (mismo criterio que docs-drift.mjs: sumar un archivo
// nuevo no vuelve vieja a la página; sí un cambio o una baja de lo ya documentado).
function archivosEnCommit(commit, source) {
  if (!commit) return null;
  if (spawnSync("git", ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], { cwd: root }).status !== 0) return null;
  const r = spawnSync("git", ["ls-tree", "-r", "--name-only", commit, "--", source], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? new Set(r.stdout.split("\n").filter(Boolean)) : null;
}
function hashSources(sources = [], sourceAt = null) {
  let files = [];
  for (const s of sources) {
    const p = path.join(root, s);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
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
      for (const f of vigentes) if (!fs.existsSync(path.join(root, f))) files.push(path.join(root, f));
    }
  }
  if (!files.length) return "";
  const sorted = [...new Set(files.map(rel))].sort();
  return sha(sorted.map((f) => {
    const abs = path.join(root, f);
    return fs.existsSync(abs) ? `${f}:${sha(fs.readFileSync(abs))}` : `${f}:borrado`;
  }).join("\n"));
}
const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : { pages: {} };
const pages = {};
const faltantes = [];
for (const file of walk(docs).filter((f) => f.endsWith(".md")).sort()) {
  const key = rel(file);
  const txt = fs.readFileSync(file, "utf8");
  const { meta, body } = frontmatter(txt);
  const pageHash = sha(txt);
  const hasSources = Object.prototype.hasOwnProperty.call(meta, "sources");
  const sources = Array.isArray(meta.sources) ? meta.sources : meta.sources ? [meta.sources] : [];
  if (!meta.owner || !hasSources) faltantes.push(`${key}${!meta.owner ? " (falta owner)" : ""}${!hasSources ? " (falta sources)" : ""}`);
  const old = prev.pages?.[key];
  // `sourceAt` fija contra qué árbol se calculó `sourceHash`: el drift compara
  // sólo los archivos que ya existían entonces (agregar una spec no vuelve
  // vieja a toda página que declara `specs` como fuente).
  const reusar = old && old.pageHash === pageHash && old.sourceAt;
  const sourceAt = sources.length ? (reusar ? old.sourceAt : ultimoCommit(key)) : null;
  const sourceHash = reusar ? old.sourceHash || "" : hashSources(sources, sourceAt);
  // --no-merges: el hash debe ser estable entre el PR y su merge. Sin esto,
  // en el checkout de merge del CI `git log` devuelve el commit efímero de
  // auto-merge (imposible de pre-commitear) y el check nunca puede dar verde
  // en un PR que toque una página con sources.
  // `commit` no puede quedar en null: si el manifest previo no lo traía, se completa con `sourceAt`
  // (el mismo commit propio de la página) y, si tampoco hay fuentes, con el último commit propio.
  // Sin esto, `docs-drift.mjs` imprime «última: ?» en vez del commit real (MSF-895).
  const commit = old && old.pageHash === pageHash ? old.commit || old.sourceAt || ultimoCommit(key) : ultimoCommit(key);
  pages[key] = {
    title: (body.match(/^#\s+(.+)$/m)?.[1] || path.basename(file)).trim(),
    pageHash,
    sourceHash,
    sourceAt,
    sources,
    owner: meta.owner || null,
    commit,
  };
}
if (faltantes.length) {
  console.error(`❌ ${faltantes.length} página(s) sin owner o sources explícitos:`);
  for (const f of faltantes) console.error(`- ${f}`);
  console.error("Agregá frontmatter: owner y sources (usá `sources: []` sólo para páginas estáticas).");
  process.exit(1);
}
fs.writeFileSync(out, JSON.stringify({ pages }, null, 2) + "\n");
const conFuentes = Object.values(pages).filter((p) => p.sources.length).length;
console.log(`Manifest: ${Object.keys(pages).length} páginas · ${conFuentes} con fuentes · ${Object.keys(pages).length - conFuentes} estáticas`);
