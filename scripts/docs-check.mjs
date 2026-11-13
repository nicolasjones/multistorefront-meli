#!/usr/bin/env node
// Verifica la documentación: nav de MkDocs, links internos, inventario y diagramas.
// Uso: node scripts/docs-check.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { erroresYaml } from "./docs-yaml.mjs";

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/**
 * Páginas declaradas en el nav. Acepta etiqueta sin citar, etiqueta citada
 * (`- "Etiqueta: con ': '": ruta.md`) y la forma inválida con toda la entrada
 * citada (`- "Etiqueta: ruta.md"`), para validar igual la ruta declarada.
 * @param {string} yml
 * @returns {string[]}
 */
export function paginasNav(yml) {
  const paginas = [];
  for (const linea of String(yml ?? "").split("\n")) {
    // - "Etiqueta": ruta.md   /   - 'Etiqueta': ruta.md
    let m = linea.match(/^\s*-\s+(?:"[^"]*"|'[^']*')\s*:\s*(\S+\.md)\s*$/);
    if (m) {
      paginas.push(m[1]);
      continue;
    }
    // - "Etiqueta: ruta.md" / - 'Etiqueta: ruta.md' (entrada mal citada: un solo ':')
    m = linea.match(/^\s*-\s+(["'])([^"':]*:[^"':]*\.md)\1\s*$/);
    if (m) {
      paginas.push(m[2].slice(m[2].indexOf(":") + 1).trim());
      continue;
    }
    // - Etiqueta: ruta.md
    m = linea.match(/^\s*-\s+[^:"'\n]+:\s*(\S+\.md)\s*$/);
    if (m) paginas.push(m[1]);
  }
  return paginas;
}

/** Un destino resuelto queda fuera de docs/ (aunque exista en el repo). */
function fueraDeDocs(docs, target) {
  const rel = path.relative(docs, target);
  return rel === "" || rel.startsWith(`..${path.sep}`) || rel === ".." || path.isAbsolute(rel);
}

/**
 * Páginas que MkDocs no publica (`exclude_docs`). No se revisan sus links: el build estricto
 * no las procesa y esas páginas se leen en GitHub.
 * @param {string} yml
 * @returns {string[]} patrones relativos a docs/
 */
export function paginasExcluidas(yml) {
  const lineas = String(yml ?? "").split("\n");
  const patrones = [];
  let dentro = false;
  for (const linea of lineas) {
    if (/^exclude_docs\s*:/.test(linea)) {
      dentro = true;
      continue;
    }
    if (!dentro) continue;
    if (!/^\s+\S/.test(linea)) break;
    const valor = linea.trim();
    if (valor && !valor.startsWith("#")) patrones.push(valor.replace(/^\/+/, ""));
  }
  return patrones;
}

/** @param {string} rel ruta relativa a docs/, con separadores '/' */
function estaExcluida(rel, patrones) {
  const normal = rel.split(path.sep).join("/");
  return patrones.some((p) => {
    if (p.endsWith("/")) return normal.startsWith(p);
    if (p.includes("*") || p.includes("?")) return path.matchesGlob(normal, p);
    return normal === p;
  });
}

/**
 * Corre todos los chequeos de documentación sobre `root`.
 * @param {string} root
 * @returns {{ errores: string[], ok: string[] }}
 */
export function verificarDocumentacion(root = process.cwd()) {
  const docs = path.join(root, "docs");
  const errores = [];
  const ok = [];

  // 1) Nav de MkDocs: cada archivo declarado existe bajo docs/.
  const mk = path.join(root, "mkdocs.yml");
  let excluidas = [];
  if (!fs.existsSync(mk)) errores.push("falta mkdocs.yml");
  else {
    const yml = fs.readFileSync(mk, "utf8");
    excluidas = paginasExcluidas(yml);
    const navs = paginasNav(yml);
    for (const n of navs) {
      const f = path.resolve(docs, n);
      if (fueraDeDocs(docs, f)) errores.push(`nav: docs/${n} queda fuera de docs/`);
      else if (!fs.existsSync(f)) errores.push(`nav: no existe docs/${n}`);
    }
    // YAML inválido: el build estricto de MkDocs falla ("mapping values are not allowed here").
    for (const e of erroresYaml(yml)) errores.push(e);
    ok.push(`nav: ${navs.length} páginas`);
  }

  // 2) Links internos de Markdown (ignora code fences y externos).
  const mdFiles = walk(docs).filter(
    (f) => f.endsWith(".md") && !estaExcluida(path.relative(docs, f), excluidas),
  );
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
      if (fueraDeDocs(docs, target)) {
        // MkDocs strict sólo resuelve archivos de docs/: un link que sale del árbol aborta el build.
        errores.push(`${path.relative(root, file)} → ${t} (fuera de docs/)`);
      } else if (!fs.existsSync(target)) {
        errores.push(`${path.relative(root, file)} → ${t} (no existe)`);
      }
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

  return { errores, ok };
}

function main() {
  const { errores, ok } = verificarDocumentacion(process.cwd());
  for (const o of ok) console.log(`✅ ${o}`);
  for (const e of errores) console.error(`❌ ${e}`);
  if (errores.length) {
    console.error(`\n${errores.length} problema(s) de documentación.`);
    process.exit(1);
  }
  console.log("\nDocumentación OK.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
