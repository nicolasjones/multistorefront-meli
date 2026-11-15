#!/usr/bin/env node
// Verifica que una spec con datos tenga su DER en Mermaid (`erDiagram`) y que el DER explique QUÉ CAMBIA:
//  - `## Modelo de datos (DER)` obligatoria.
//  - Tabla de leyenda `| Tabla | Estado | Cambio |` con estados `nueva` / `alterada` / `existente`.
//  - Todas las tablas de la leyenda aparecen en el `erDiagram` (se muestran todas, también las existentes).
//  - Si hay una tabla `alterada`, al menos una columna del diagrama está marcada con un comentario
//    `"nueva: …"` o `"alterada: …"`.
// Uso:
//   node scripts/verificar-der.mjs                 # specs cambiadas vs. la base (GITHUB_BASE_REF / HEAD~1)
//   node scripts/verificar-der.mjs specs/x/spec.md # una o más specs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const sinBackticks = (s) => String(s || "").replace(/`/g, "").trim();
const nombreTabla = (s) => sinBackticks(s).split(".").pop().trim().toLowerCase();

export function verificarDer(texto = "") {
  const txt = String(texto);
  if (!/^##\s+Modelo de datos \(DER\)\s*$/im.test(txt)) {
    return { ok: false, motivo: "falta la sección `## Modelo de datos (DER)`" };
  }
  // Sección: desde el heading hasta el próximo `## ` (o fin).
  const m = txt.match(/^##\s+Modelo de datos \(DER\)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  const sec = m ? m[1] : txt;
  const bloques = [...sec.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((x) => x[1]);
  const er = bloques.find((b) => /^\s*erDiagram\b/im.test(b));
  if (!er) return { ok: false, motivo: "la sección no tiene un bloque ```mermaid con `erDiagram`" };

  // Leyenda: encabezado con Tabla | Estado | Cambio.
  const lineas = sec.split(/\r?\n/);
  const hi = lineas.findIndex((l) => /^\s*\|/.test(l) && /\btabla\b/i.test(l) && /\bestado\b/i.test(l) && /\bcambio\b/i.test(l));
  if (hi === -1) {
    return { ok: false, motivo: "falta la tabla de leyenda `| Tabla | Estado | Cambio |`" };
  }
  const filas = [];
  for (let i = hi + 2; i < lineas.length; i++) { // +2 salta el separador |---|
    const l = lineas[i];
    if (!/^\s*\|/.test(l)) break;
    const celdas = l.split("|").slice(1, -1).map((c) => c.trim());
    if (celdas.length < 3) continue;
    filas.push({ tabla: celdas[0], estado: celdas[1].toLowerCase(), cambio: celdas[2] });
  }
  if (!filas.length) return { ok: false, motivo: "la leyenda no tiene filas de tablas" };

  const faltan = filas.filter((f) => !new RegExp(`\\b${nombreTabla(f.tabla).replace(/[^a-z0-9_]/g, "")}\\b`, "i").test(er));
  if (faltan.length) {
    return { ok: false, motivo: `la leyenda lista tablas que no están en el erDiagram: ${faltan.map((f) => sinBackticks(f.tabla)).join(", ")}` };
  }
  if (filas.some((f) => /alterada/.test(f.estado))) {
    const marcada = /"[^"]*\b(nueva|alterada)\b[^"]*"/i.test(er);
    if (!marcada) {
      return { ok: false, motivo: "hay una tabla alterada pero ninguna columna está marcada con un comentario \"nueva: …\" o \"alterada: …\"" };
    }
  }
  return { ok: true, motivo: "DER OK" };
}

function specsCambiadas() {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : (process.env.DOCUMENTATION_CHECK_BASE || "HEAD~1");
  const r = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`, "--", "specs"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((f) => /^specs\/.+\/spec\.md$/.test(f));
}

function todas() {
  const r = spawnSync("git", ["ls-files", "specs/*/spec.md"], { encoding: "utf8" });
  return (r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const archivos = args.length ? args : (specsCambiadas().length ? specsCambiadas() : todas());
  if (!archivos.length) {
    console.log("DER: no hay specs para verificar.");
    return 0;
  }
  let fallas = 0;
  for (const f of archivos) {
    if (!fs.existsSync(f)) {
      console.error(`❌ ${f}: no existe`);
      fallas++;
      continue;
    }
    const r = verificarDer(fs.readFileSync(f, "utf8"));
    if (r.ok) console.log(`✅ ${f}: ${r.motivo}`);
    else {
      console.error(`❌ ${f}: ${r.motivo}`);
      fallas++;
    }
  }
  if (fallas) {
    console.error(`\n${fallas} spec(s) sin DER válido. Ver la convención en la plantilla de spec.`);
    return 1;
  }
  console.log(`\nDER OK (${archivos.length} spec/s).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
