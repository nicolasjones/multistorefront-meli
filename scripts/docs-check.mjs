#!/usr/bin/env node
// Verifica la documentación: nav de MkDocs, links internos, inventario y diagramas.
// Uso: node scripts/docs-check.mjs
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docs = path.join(root, "docs");
const errores = [];
const ok = [];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

// 1) Nav de MkDocs: cada archivo declarado existe.
const mk = path.join(root, "mkdocs.yml");
if (!fs.existsSync(mk)) errores.push("falta mkdocs.yml");
else {
  const yml = fs.readFileSync(mk, "utf8");
  const navs = [...yml.matchAll(/^\s*-\s+[^:\n]+:\s*(\S+\.md)\s*$/gm)].map((m) => m[1]);
  for (const n of navs) {
    const f = path.join(docs, n);
    if (!fs.existsSync(f)) errores.push(`nav: no existe docs/${n}`);
  }
  ok.push(`nav: ${navs.length} páginas`);
}

// 2) Links internos de Markdown (ignora code fences y externos).
const mdFiles = walk(docs).filter((f) => f.endsWith(".md"));
let links = 0;
for (const file of mdFiles) {
  let txt = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of txt.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let t = m[1].replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#|\/)/i.test(t)) continue;
    t = decodeURIComponent(t.split("#")[0].split("?")[0]);
    if (!t) continue;
    links++;
    const target = path.resolve(path.dirname(file), t);
    if (!fs.existsSync(target)) errores.push(`${path.relative(root, file)} → ${t} (no existe)`);
  }
}
ok.push(`links internos: ${links}`);

// 3) Inventario generado.
const inv = path.join(docs, "_generated", "inventory.json");
if (!fs.existsSync(inv)) errores.push("falta docs/_generated/inventory.json (corré docs:wiki:inventario)");
else {
  try {
    const j = JSON.parse(fs.readFileSync(inv, "utf8"));
    for (const k of ["rutas", "tablas", "variables", "specs"]) {
      if (!Array.isArray(j[k])) errores.push(`inventario: falta el array "${k}"`);
    }
    ok.push("inventario: JSON válido");
  } catch (e) { errores.push(`inventario: JSON inválido (${e.message})`); }
}

// 4) Diagramas Archify referenciados.
const diagramas = fs.existsSync(path.join(docs, "diagrams"))
  ? fs.readdirSync(path.join(docs, "diagrams")).filter((f) => /\.html?$/.test(f))
  : [];
if (!diagramas.length) errores.push("no hay diagramas en docs/diagrams");
else ok.push(`diagramas: ${diagramas.length}`);

for (const o of ok) console.log(`✅ ${o}`);
for (const e of errores) console.error(`❌ ${e}`);
if (errores.length) {
  console.error(`\n${errores.length} problema(s) de documentación.`);
  process.exit(1);
}
console.log("\nDocumentación OK.");
