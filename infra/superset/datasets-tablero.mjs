// Allowlist de datasets de cada tablero embebido. Se deriva de los YAML versionados (no de Superset): el
// importador la guarda en `public.reportes.datasets_permitidos` y `emitir-acceso-reporte` veda al token de ese
// tablero todo dataset de Superset que no esté en la lista (el rol Guest es único y ve todos los datasets).
//
// Un tablero usa los datasets de sus gráficos (cada gráfico del `position` del dashboard) y los de sus filtros
// nativos (`native_filter_configuration[].targets[].datasetUuid`). Un dataset virtual o derivado es un dataset más
// (tiene su propio YAML y `table_name`). Si un tablero necesita datasets que estos YAML no reflejan (p. ej. un gráfico
// de varios datasets), se declaran a mano en `datasets_permitidos_extra` de su entrada en reportes.json.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NOMBRE_DATASET = /^[a-z0-9_]+$/;

async function yamls(directorio) {
  const archivos = [];
  let entradas;
  try {
    entradas = await readdir(directorio, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return archivos;
    throw error;
  }
  for (const entrada of entradas) {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) archivos.push(...(await yamls(ruta)));
    else if (/\.ya?ml$/.test(entrada.name)) archivos.push(ruta);
  }
  return archivos;
}

const campo = (texto, nombre) => texto.match(new RegExp(`^${nombre}: (.+)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');

const UUID_EN_TEXTO = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Devuelve los `table_name` de los datasets que usa el tablero con ese `slug` dentro del directorio exportado.
export async function datasetsDeTablero(directorio, slug) {
  const leer = async (subdirectorio) => Promise.all((await yamls(path.join(directorio, subdirectorio))).map((ruta) => readFile(ruta, 'utf8')));
  const [tableros, graficos, datasets] = await Promise.all([leer('dashboards'), leer('charts'), leer('datasets')]);

  const tablero = tableros.find((texto) => campo(texto, 'slug') === slug);
  if (!tablero) throw new Error(`No hay un tablero con slug "${slug}" en ${directorio}.`);

  // Los YAML del tablero vienen en dos formas (JSON en una línea o YAML en bloque): en vez de interpretarlas se
  // toman TODOS los UUID que menciona el tablero (gráficos en `position`, `datasetUuid` de los filtros nativos) y se
  // cruzan con los gráficos y datasets del directorio. Un UUID ajeno no aparece en el tablero, así que no suma datasets.
  const mencionados = new Set((tablero.match(UUID_EN_TEXTO) ?? []).map((uuid) => uuid.toLowerCase()));
  const uuidsDataset = new Set();
  for (const grafico of graficos) {
    if (mencionados.has(campo(grafico, 'uuid')?.toLowerCase()) && campo(grafico, 'dataset_uuid')) {
      uuidsDataset.add(campo(grafico, 'dataset_uuid').toLowerCase());
    }
  }
  for (const uuid of mencionados) uuidsDataset.add(uuid);

  const nombres = new Set();
  for (const dataset of datasets) {
    if (uuidsDataset.has(campo(dataset, 'uuid')?.toLowerCase())) nombres.add(campo(dataset, 'table_name'));
  }
  const uuidsDeDatasets = new Set(datasets.map((dataset) => campo(dataset, 'uuid')?.toLowerCase()));
  for (const grafico of graficos) {
    const referido = campo(grafico, 'dataset_uuid')?.toLowerCase();
    if (mencionados.has(campo(grafico, 'uuid')?.toLowerCase()) && referido && !uuidsDeDatasets.has(referido)) {
      throw new Error(`El tablero "${slug}" usa un gráfico cuyo dataset no está en ${directorio}/datasets.`);
    }
  }
  return [...nombres].sort();
}

// Allowlist completa de una entrada de reportes.json: los datasets derivados + `datasets_permitidos_extra`.
// Falla si queda vacía: un tablero sin allowlist no puede emitir token.
export async function datasetsPermitidos(directorio, reporte) {
  const derivados = reporte.dashboard_slug ? await datasetsDeTablero(directorio, reporte.dashboard_slug) : [];
  const extra = reporte.datasets_permitidos_extra ?? [];
  const todos = [...new Set([...derivados, ...extra])].sort();
  if (todos.length === 0) throw new Error(`El reporte ${reporte.nombre} no tiene datasets: declará "datasets_permitidos_extra".`);
  for (const nombre of todos) {
    if (!NOMBRE_DATASET.test(nombre)) throw new Error(`El reporte ${reporte.nombre} tiene un nombre de dataset inválido: ${nombre}.`);
  }
  return todos;
}

// Uso manual: `node infra/superset/datasets-tablero.mjs` imprime la allowlist de todos los tableros versionados
// (el formato de `datasets-tablero.snapshot.json`), para regenerarlo al cambiar un tablero o dataset.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const raiz = path.resolve('infra/superset/dashboards');
  const tableros = {};
  for (const directorio of (await readdir(raiz)).sort()) {
    const { reportes } = JSON.parse(await readFile(path.join(raiz, directorio, 'reportes.json'), 'utf8'));
    for (const reporte of reportes) tableros[reporte.nombre] = await datasetsPermitidos(path.join(raiz, directorio), reporte);
  }
  console.log(JSON.stringify({ tableros }, null, 2));
}
