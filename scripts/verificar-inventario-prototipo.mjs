#!/usr/bin/env node
// Vigilancia del inventario del prototipo (FR-017).
//
// `design/pantallas/**/*.dc.html` es la fuente de verdad de la UI. Cada
// prototipo debe tener su `.inventory.json` (checklist determinista de tablas,
// campos, botones, tabs y diálogos) generado con `pnpm prototipo:inventario`.
// Si un `.dc.html` cambia y su inventario no, el CI falla: es el eslabón que
// obliga a que la spec mapee el prototipo real y no una idea de memoria.
//
// Uso:
//   node scripts/verificar-inventario-prototipo.mjs            (verifica)
//   node scripts/verificar-inventario-prototipo.mjs --escribir (regenera)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inventariar } from "./prototipo-inventario.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
export const CARPETA_PROTOTIPO = "design/pantallas";

export function archivosPrototipo(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.dc\.html$/i.test(e.name)) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

const destinoDe = (archivoDc) => archivoDc.replace(/\.dc\.html$/i, ".inventory.json");

// Devuelve { total, faltan, desfasados } relativo a `raiz`.
export function verificarInventario(raiz = RAIZ, carpeta = CARPETA_PROTOTIPO) {
  const archivos = archivosPrototipo(path.join(raiz, carpeta));
  const faltan = [];
  const desfasados = [];
  for (const archivo of archivos) {
    const inv = inventariar(fs.readFileSync(archivo, "utf8"), path.basename(archivo));
    const esperado = JSON.stringify(inv, null, 2);
    const destino = destinoDe(archivo);
    if (!fs.existsSync(destino)) faltan.push(path.relative(raiz, destino));
    else if (fs.readFileSync(destino, "utf8") !== esperado) desfasados.push(path.relative(raiz, destino));
  }
  return { total: archivos.length, faltan, desfasados };
}

export function escribirInventario(raiz = RAIZ, carpeta = CARPETA_PROTOTIPO) {
  const archivos = archivosPrototipo(path.join(raiz, carpeta));
  for (const archivo of archivos) {
    const inv = inventariar(fs.readFileSync(archivo, "utf8"), path.basename(archivo));
    fs.writeFileSync(destinoDe(archivo), JSON.stringify(inv, null, 2));
  }
  return archivos.length;
}

const esCLI = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (esCLI) {
  if (process.argv.includes("--escribir")) {
    console.log(`Inventario del prototipo: ${escribirInventario()} archivos escritos.`);
  } else {
    const { total, faltan, desfasados } = verificarInventario();
    if (faltan.length || desfasados.length) {
      console.error("Fallo de inventario del prototipo: cada .dc.html necesita su .inventory.json al día.");
      if (faltan.length) console.error("Sin inventario:\n" + faltan.map((p) => ` - ${p}`).join("\n"));
      if (desfasados.length) console.error("Desfasados (regenerá con `pnpm prototipo:inventario`):\n" + desfasados.map((p) => ` - ${p}`).join("\n"));
      process.exit(1);
    }
    console.log(`Inventario del prototipo: OK (${total} pantallas al día).`);
  }
}
