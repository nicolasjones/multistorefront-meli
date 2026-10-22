#!/usr/bin/env node
// Inventario DETERMINISTA de un prototipo DesignCompose (.dc.html): extrae el checklist de UI
// (tablas+columnas, campos, botones, tabs, filtros, diálogos) para que la spec lo mapee 1:1 a criterios
// de aceptación (matriz pantalla↔CA) y el QA lo verifique. Sin LLMs, sin opinión: lo visible manda.
// Uso:
//   node scripts/prototipo-inventario.mjs design/pantallas/Clientes.dc.html [--json]
//   node scripts/prototipo-inventario.mjs design/pantallas/  (toda la carpeta; escribe .inventory.json junto a cada .dc.html)
// Sin args: procesa design/pantallas/ si existe.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ")
  .replace(/\{\{[^}]*\}\}/g, "·").replace(/\s+/g, " ").trim();
const vacio = (s) => !s || /^[·•\s]+$/.test(s);
const uniq = (a) => [...new Set(a.map((x) => x.trim()).filter((x) => x && !vacio(x)))];

function tablas(html) {
  const out = [];
  for (const m of html.matchAll(/<table[^>]*class="[^"]*\btbl\b[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)) {
    const cols = [...m[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => strip(h[1]));
    out.push({ columnas: cols });
  }
  return out;
}
function campos(html) {
  // labels de formulario (.fld .l) + placeholders de inputs
  const labels = [...html.matchAll(/<span class="l">([\s\S]*?)<\/span>/gi)].map((m) => strip(m[1]));
  const ph = [...html.matchAll(/placeholder="([^"]+)"/gi)].map((m) => m[1].trim());
  return uniq([...labels, ...ph.map((p) => `(buscar: ${p})`)]);
}
function botones(html) {
  // <button> y <a class="btn"> con texto visible (sin solo-icono)
  const out = [];
  for (const m of html.matchAll(/<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)) {
    const t = strip(m[1]);
    if (t && t.length > 1 && !/^[×✕]+$/.test(t)) out.push(t);
  }
  return uniq(out).slice(0, 60);
}
function tabs(html) {
  const out = [];
  for (const m of html.matchAll(/class="tab\b[^"]*"[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)) out.push(strip(m[1]));
  return uniq(out);
}
function dialogos(html) {
  const out = [];
  for (const m of html.matchAll(/role="dialog"[^>]*>([\s\S]*?)(?=role="dialog"|$)/gi)) {
    const titu = (m[1].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1];
    if (vacio(strip(titu)) && !m[1].includes('class="l"')) continue;
    const flds = [...m[1].matchAll(/<span class="l">([\s\S]*?)<\/span>/gi)].map((x) => strip(x[1]));
    out.push({ titulo: strip(titu) || "(diálogo)", campos: uniq(flds) });
  }
  return out;
}
function tituloDoc(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return strip(m?.[1]) || path.basename("?");
}

export function inventariar(html, nombre = "?") {
  return {
    pantalla: tituloDoc(html) || nombre,
    archivo: nombre,
    tablas: tablas(html),
    campos: campos(html),
    botones: botones(html),
    tabs: tabs(html),
    dialogos: dialogos(html),
  };
}

function renderMd(inv) {
  const L = [`# Inventario UI — ${inv.pantalla}`, ``, `Fuente: \`${inv.archivo}\` (generado, no editar a mano).`, ``];
  inv.tablas.forEach((t, i) => { L.push(`## Tabla ${i + 1}`, `- Columnas: ${t.columnas.join(" | ") || "(s/c)"}`, ""); });
  if (inv.tabs.length) L.push(`## Tabs`, ...inv.tabs.map((t) => `- ${t}`), "");
  if (inv.campos.length) L.push(`## Campos`, ...inv.campos.map((c) => `- [ ] ${c}`), "");
  if (inv.botones.length) L.push(`## Botones/acciones`, ...inv.botones.map((b) => `- [ ] ${b}`), "");
  inv.dialogos.forEach((d) => { L.push(`## Diálogo: ${d.titulo}`, ...d.campos.map((c) => `- [ ] ${c}`), ""); });
  L.push(`---`, `Cada ítem [ ] debe mapear a un criterio de aceptación de la spec o declararse fuera de alcance explícito.`);
  return L.join("\n");
}

function archivosDc(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.dc\.html$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const targets = args.filter((a) => a !== "--json");
const esCLI = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; } catch { return false; } })();
if (!esCLI) {
  // Importado (tests): sólo exportar.
} else {
let files = [];
if (!targets.length && fs.existsSync("design/pantallas")) files = archivosDc("design/pantallas");
for (const t of targets) {
  if (fs.existsSync(t) && fs.statSync(t).isDirectory()) files.push(...archivosDc(t));
  else if (/\.dc\.html$/i.test(t)) files.push(t);
}
if (!files.length) { console.error("Sin .dc.html (uso: node scripts/prototipo-inventario.mjs <archivo|carpeta> [--json])"); process.exit(1); }
for (const f of files) {
  const inv = inventariar(fs.readFileSync(f, "utf8"), path.basename(f));
  if (files.length === 1) {
    console.log(asJson ? JSON.stringify(inv, null, 2) : renderMd(inv));
  } else {
    const dest = f.replace(/\.dc\.html$/i, ".inventory.json");
    fs.writeFileSync(dest, JSON.stringify(inv, null, 2));
    console.log(`${f} -> tablas:${inv.tablas.length} campos:${inv.campos.length} botones:${inv.botones.length} diálogos:${inv.dialogos.length}`);
  }
} // fin esCLI

}
