#!/usr/bin/env node
// Gate de spec con UI (FR-018).
//
// Una spec nueva que toca pantallas (`apps/web/src/pages`, sus componentes o
// un prototipo en `design/pantallas`) debe declarar la sección
// `## Matriz pantalla↔criterios`: el mapeo 1:1 entre lo visible del prototipo y
// los criterios de aceptación (o el fuera de alcance explícito). Sin eso, la
// spec no puede aprobar: lo visible manda.
//
// Sólo revisa specs NUEVAS del rango (no rompe specs ya mergeadas). Base:
// GITHUB_BASE_REF (CI) o `HEAD~1` (local).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
export const SECCION_MATRIZ = /^##\s+Matriz pantalla/im;
// La empresa activa (constitución, Principio VIII): la matriz debe decir qué
// pasa con ella, o declarar «no aplica» y por qué. No es prosa opcional.
export const MENCION_EMPRESA = /empresa/i;
export const MENCIONA_UI = /apps\/web\/src\/(pages|components)\b|design\/pantallas\b/;
export const ARCHIVO_EXENTAS = "scripts/matriz-pantalla-exentas.txt";

// Specs previas a la vigilancia: se exceptúan para no reescribir historial.
export function specsExentas(archivo = path.join(RAIZ, ARCHIVO_EXENTAS)) {
  if (!fs.existsSync(archivo)) return new Set();
  return new Set(
    fs
      .readFileSync(archivo, "utf8")
      .split(/\r?\n/)
      .map((linea) => linea.replace(/#.*/, "").trim())
      .filter(Boolean),
  );
}

// La matriz existe pero no dice nada de la empresa activa.
export function motivoSpecSinEmpresa(specMd) {
  if (!fs.existsSync(specMd)) return null;
  const contenido = fs.readFileSync(specMd, "utf8");
  if (!MENCIONA_UI.test(contenido) || !SECCION_MATRIZ.test(contenido)) return null;
  const cuerpo = (contenido.split(SECCION_MATRIZ)[1] ?? "").split(/\n##\s/)[0];
  return MENCION_EMPRESA.test(cuerpo) ? null : specMd;
}

// Revisa el spec.md de un directorio: devuelve el motivo si falta la matriz, o null si está bien.
export function motivoSpecSinMatriz(specMd) {
  if (!fs.existsSync(specMd)) return null;
  const contenido = fs.readFileSync(specMd, "utf8");
  if (!MENCIONA_UI.test(contenido)) return null;
  if (SECCION_MATRIZ.test(contenido)) return null;
  return specMd;
}

const run = (args) => spawnSync("git", args, { encoding: "utf8", cwd: RAIZ });
const base = (() => {
  const candidata = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : (process.env.MATRIZ_CHECK_BASE || "HEAD~1");
  if (run(["rev-parse", "--verify", candidata]).status === 0) return candidata;
  return run(["rev-parse", "--verify", "HEAD~1"]).status === 0 ? "HEAD~1" : null;
})();

const esCLI = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (esCLI) {
  if (!base) {
    console.error("No se pudo resolver la base para revisar specs (GITHUB_BASE_REF / HEAD~1).");
    process.exit(1);
  }
  const diff = run(["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`]);
  if (diff.status !== 0) {
    console.error(diff.stderr.trim() || "No se pudo inspeccionar el diff de specs.");
    process.exit(diff.status || 1);
  }
  const specsNuevas = diff.stdout
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter((p) => /^specs\/[^/]+\/spec\.md$/.test(p))
    .map((p) => path.join(RAIZ, p));
  const exentas = specsExentas();
  const aRevisar = specsNuevas.filter((p) => !exentas.has(path.relative(RAIZ, path.dirname(p))));
  const faltantes = aRevisar.map(motivoSpecSinMatriz).filter(Boolean);
  const sinEmpresa = aRevisar.filter((p) => !faltantes.includes(p) && motivoSpecSinEmpresa(p));
  if (faltantes.length || sinEmpresa.length) {
    if (faltantes.length) {
      console.error("Fallo de spec: una spec nueva con UI debe traer `## Matriz pantalla↔criterios`.");
      console.error(faltantes.map((p) => ` - ${path.relative(RAIZ, p)}`).join("\n"));
    }
    if (sinEmpresa.length) {
      console.error("Fallo de spec: la matriz debe incluir «Empresa activa» (o «Empresa activa: no aplica» y el motivo).");
      console.error(sinEmpresa.map((p) => ` - ${path.relative(RAIZ, p)}`).join("\n"));
    }
    process.exit(1);
  }
  console.log(`Matriz pantalla↔criterios: OK (${aRevisar.length} specs nuevas revisadas, ${specsNuevas.length - aRevisar.length} exentas).`);
}
