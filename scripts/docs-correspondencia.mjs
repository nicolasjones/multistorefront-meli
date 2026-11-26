// Correspondencia código -> doc (MSF-869/MSF-688). Lógica pura, sin efectos: la usa
// verificar-documentacion-cambios.mjs. El mapa es el front matter `sources:` de docs/**/*.md
// (el mismo que consumen docs-manifest.mjs y docs-drift.mjs); no hay otro mapa que mantener.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { itemDeLista } from './docs-lineas.mjs';

const RUTAS_CODIGO = /^(apps|workers|supabase|infra|scripts|packages|\.github)\//;
// Fuera de la correspondencia: tests, fixtures/snapshots, lockfiles y migraciones (las cubre verificar-migraciones).
const TRIVIAL = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|__snapshots__|tests?|e2e|fixtures)\/|\.snap$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|^supabase\/migrations\/)/;
// Un `sources:` que apunta a más de este número de rutas es demasiado amplio para exigir su doc.
const MAX_FUENTES_POR_DOC = 40;

// Fuentes que abarcan un área entera (`infra`, `.github/workflows`): no identifican un doc concreto.
const esFuenteAmplia = (fuente) => fuente.split('/').length < 2 || fuente === '.github/workflows';

const esArchivoRelevante = (ruta) => RUTAS_CODIGO.test(ruta) && !TRIVIAL.test(ruta);

// Mismo criterio que `frontmatter()` de docs-manifest.mjs (lista en bloque, `[]`), más array en línea,
// escalar, CRLF, comentarios finales y comillas.
// Tiempo lineal con líneas patológicas: los ítems se parsean a mano (docs-lineas.mjs, sin regex ambigua) y las regex que
// quedan son acotadas (`\s#.*$`, comillas en los bordes) o se aplican a una sola posición; las barras finales se quitan con un
// bucle. Probado con 200 000 de espacio, tab, NBSP, U+2028, U+2029, U+0085, `\r`, `#`, comillas, guiones, comas y corchetes.
const quitarBarrasFinales = (v) => { let fin = v.length; while (fin > 0 && v[fin - 1] === '/') fin -= 1; return v.slice(0, fin); };
const limpiarItem = (v) => quitarBarrasFinales(v.replace(/\s#.*$/, '').trim().replace(/^["']|["']$/g, ''));

function fuentesDeDoc(texto) {
  const m = texto.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const fuentes = [];
  let enSources = false;
  for (const linea of m[1].split('\n')) {
    const kv = linea.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) {
      enSources = kv[1] === 'sources';
      if (enSources) {
        const v = kv[2].replace(/\s#.*$/, '').trim();
        const enLinea = v.match(/^\[(.*)\]$/);
        if (enLinea) fuentes.push(...enLinea[1].split(',').map(limpiarItem));
        else if (v) fuentes.push(limpiarItem(v));
      }
      continue;
    }
    const item = itemDeLista(linea);
    if (enSources && item) fuentes.push(limpiarItem(item));
  }
  return fuentes.filter(Boolean);
}

// Escape de anotaciones de GitHub Actions (igual que @actions/core). Un nombre de archivo o de doc
// viene del PR: sin escapar, `%0A::add-mask::x` en la salida se decodifica y se ejecuta como comando.
export const escaparDato = (v) => String(v).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escaparPropiedad = (v) => escaparDato(v).replace(/:/g, '%3A').replace(/,/g, '%2C');
export const anotacion = (nivel, props, mensaje) => `::${nivel} ${Object.entries(props).map(([k, v]) => `${k}=${escaparPropiedad(v)}`).join(',')}::${escaparDato(mensaje)}`;
// Línea legible que lista un nombre: siempre empieza con "- ", sin saltos de línea ni `::`.
export const lineaLista = (nombre, sangria = '') => `${sangria}- ${String(nombre).replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/::/g, ':\u200b:')}`;

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
        let sources;
        try { sources = fuentesDeDoc(readFileSync(p, 'utf8')); } catch { continue; } // ilegible, symlink roto, carpeta *.md
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
