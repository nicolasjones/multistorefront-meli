// Correspondencia código -> doc (MSF-869/MSF-688). Lógica pura, sin efectos: la usa
// verificar-documentacion-cambios.mjs. El mapa es el front matter `sources:` de docs/**/*.md
// (el mismo que consumen docs-manifest.mjs y docs-drift.mjs); no hay otro mapa que mantener.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const RUTAS_CODIGO = /^(apps|workers|supabase|infra|scripts|packages|\.github)\//;
// Fuera de la correspondencia: tests, fixtures/snapshots, lockfiles y migraciones (las cubre verificar-migraciones).
const TRIVIAL = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|__snapshots__|tests?|e2e|fixtures)\/|\.snap$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|^supabase\/migrations\/)/;
// Un `sources:` que apunta a más de este número de rutas es demasiado amplio para exigir su doc.
const MAX_FUENTES_POR_DOC = 40;

// Fuentes que abarcan un área entera (`infra`, `.github/workflows`): no identifican un doc concreto.
const esFuenteAmplia = (fuente) => fuente.split('/').length < 2 || fuente === '.github/workflows';

const esArchivoRelevante = (ruta) => RUTAS_CODIGO.test(ruta) && !TRIVIAL.test(ruta);

function fuentesDeDoc(texto) {
  const m = texto.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const fuentes = [];
  let enSources = false;
  for (const linea of m[1].split('\n')) {
    const kv = linea.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) { enSources = kv[1] === 'sources'; continue; }
    const li = linea.match(/^\s*-\s*(.+)$/);
    if (enSources && li) fuentes.push(li[1].trim().replace(/^["']|["']$/g, '').replace(/\/+$/, ''));
  }
  return fuentes;
}

// docs: [{ doc: 'docs/x.md', sources: [...] }] -> los que declaran de 1 a MAX_FUENTES_POR_DOC rutas.
export const leerMapaDocs = (raiz) => {
  const docs = [];
  const recorrer = (dir) => {
    let entradas;
    try { entradas = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['_generated', 'node_modules'].includes(e.name)) recorrer(p); }
      else if (e.name.endsWith('.md')) {
        const sources = fuentesDeDoc(readFileSync(p, 'utf8'));
        if (sources.length) docs.push({ doc: path.relative(raiz, p).split(path.sep).join('/'), sources });
      }
    }
  };
  recorrer(path.join(raiz, 'docs'));
  return docs;
};

const cubre = (fuente, ruta) => ruta === fuente || ruta.startsWith(`${fuente}/`);

// Devuelve los archivos relevantes cambiados que figuran en algún `sources:` y cuyos docs
// correspondientes no se tocaron: [{ archivo, docs: [...] }]. Sin doc asignado -> no aparece.
export function archivosSinDocCorrespondiente(cambiados, docs) {
  const tocados = new Set(cambiados);
  const utiles = docs.filter((d) => d.sources.length <= MAX_FUENTES_POR_DOC);
  const sinDoc = [];
  for (const archivo of cambiados.filter(esArchivoRelevante)) {
    const correspondientes = utiles.filter((d) => d.sources.some((s) => !esFuenteAmplia(s) && cubre(s, archivo))).map((d) => d.doc);
    if (correspondientes.length > 0 && !correspondientes.some((d) => tocados.has(d))) sinDoc.push({ archivo, docs: correspondientes });
  }
  return sinDoc;
}
