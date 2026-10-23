// Empaqueta los dashboards versionados en `infra/superset/dashboards/<producto>/` en el ZIP que
// consume `POST /api/v1/dashboard/import/` de Superset (F-REN-01, FR-009).
//
// Los YAML se commitean tal cual se exportan de Superset, con dos cuidados:
//   - Los valores de entorno (`${SUPERSET_ANALITICA_DB_HOST}`) se reemplazan al empaquetar; si falta
//     una variable se falla nombrando cuál, en vez de importar una conexión rota.
//   - Los archivos propios del repo (`reportes.json`) no viajan en el paquete: los consume el
//     importador para registrar los reportes en la base de la app.
//
// Sin dependencias externas: ZIP con método `store` (sin compresión), suficiente para el import de
// Superset y determinista (misma entrada → mismo paquete). No incluye credenciales: la contraseña de
// la base queda enmascarada como XXXXXXXXXX y el importador la manda aparte (`passwords`).
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARCA_CREDENCIAL = /postgres(?:ql)?(?:\+[a-z0-9]+)?:\/\/[^:\s/]+:(?!X{10})[^@\s/]+@/i;
const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)\}/g;

const CRC_TABLE = (() => {
  const tabla = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[i] = c >>> 0;
  }
  return tabla;
})();

export function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fecha DOS fija: el contenido del paquete no cambia entre corridas.
const DOS_HORA = 0;
const DOS_FECHA = ((2026 - 1980) << 9) | (1 << 5) | 1;

function cabeceraLocal(nombre, crc, tamano) {
  const cabecera = Buffer.alloc(30);
  cabecera.writeUInt32LE(0x04034b50, 0);
  cabecera.writeUInt16LE(20, 4);
  cabecera.writeUInt16LE(0x0800, 6);
  cabecera.writeUInt16LE(0, 8);
  cabecera.writeUInt16LE(DOS_HORA, 10);
  cabecera.writeUInt16LE(DOS_FECHA, 12);
  cabecera.writeUInt32LE(crc, 14);
  cabecera.writeUInt32LE(tamano, 18);
  cabecera.writeUInt32LE(tamano, 22);
  cabecera.writeUInt16LE(Buffer.byteLength(nombre), 26);
  cabecera.writeUInt16LE(0, 28);
  return cabecera;
}

function cabeceraCentral(nombre, crc, tamano, desplazamiento) {
  const cabecera = Buffer.alloc(46);
  cabecera.writeUInt32LE(0x02014b50, 0);
  cabecera.writeUInt16LE(20, 4);
  cabecera.writeUInt16LE(20, 6);
  cabecera.writeUInt16LE(0x0800, 8);
  cabecera.writeUInt16LE(0, 10);
  cabecera.writeUInt16LE(DOS_HORA, 12);
  cabecera.writeUInt16LE(DOS_FECHA, 14);
  cabecera.writeUInt32LE(crc, 16);
  cabecera.writeUInt32LE(tamano, 20);
  cabecera.writeUInt32LE(tamano, 24);
  cabecera.writeUInt16LE(Buffer.byteLength(nombre), 28);
  cabecera.writeUInt16LE(0, 30);
  cabecera.writeUInt16LE(0, 32);
  cabecera.writeUInt16LE(0, 34);
  cabecera.writeUInt16LE(0, 36);
  cabecera.writeUInt32LE(0, 38);
  cabecera.writeUInt32LE(desplazamiento, 42);
  return cabecera;
}

export function crearZip(archivos) {
  const partes = [];
  const centrales = [];
  let desplazamiento = 0;
  for (const { nombre, contenido } of [...archivos].sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const datos = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, 'utf8');
    const crc = crc32(datos);
    const local = cabeceraLocal(nombre, crc, datos.length);
    const nombreBuf = Buffer.from(nombre, 'utf8');
    partes.push(local, nombreBuf, datos);
    centrales.push(cabeceraCentral(nombre, crc, datos.length, desplazamiento), nombreBuf);
    desplazamiento += local.length + nombreBuf.length + datos.length;
  }
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  fin.writeUInt16LE(0, 20);
  return Buffer.concat([...partes, directorio, fin]);
}

async function listarArchivos(directorio, prefijo = '') {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const resultado = [];
  for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entrada.name.startsWith('.')) continue;
    if (entrada.name === 'reportes.json') continue;
    const relativo = path.posix.join(prefijo, entrada.name);
    const absoluto = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...(await listarArchivos(absoluto, relativo)));
    } else if (entrada.isFile()) {
      resultado.push({ nombre: relativo, absoluto });
    }
  }
  return resultado;
}

export function reemplazarVariables(contenido, variables) {
  return contenido.replace(PLACEHOLDER, (_, nombre) => {
    const valor = variables[nombre];
    if (!valor) throw new Error(`Falta la variable de entorno ${nombre} para empaquetar los dashboards.`);
    return valor;
  });
}

export async function empaquetarDashboards({ directorio, variables = {} }) {
  let info;
  try {
    info = await stat(directorio);
  } catch {
    throw new Error(`No existe el directorio de dashboards ${directorio}.`);
  }
  if (!info.isDirectory()) throw new Error(`${directorio} no es un directorio.`);

  const archivos = [];
  for (const archivo of await listarArchivos(directorio)) {
    const texto = await readFile(archivo.absoluto, 'utf8');
    if (MARCA_CREDENCIAL.test(texto)) {
      throw new Error(`El archivo ${archivo.nombre} tiene una credencial real; el paquete solo admite la contraseña enmascarada XXXXXXXXXX.`);
    }
    archivos.push({ nombre: archivo.nombre, contenido: reemplazarVariables(texto, variables) });
  }
  if (archivos.length === 0) throw new Error(`El directorio ${directorio} no tiene archivos para empaquetar.`);
  return crearZip(archivos);
}

// Nombres de los archivos de conexión dentro del paquete (para el mapa `passwords` del import).
export async function conexionesDelDirectorio(directorio) {
  const resultado = [];
  for (const archivo of await listarArchivos(directorio)) {
    if (archivo.nombre.startsWith('databases/')) resultado.push(archivo.nombre);
  }
  return resultado;
}

async function main() {
  const args = process.argv.slice(2);
  const valor = (nombre) => {
    const indice = args.indexOf(nombre);
    return indice === -1 ? undefined : args[indice + 1];
  };
  const directorio = valor('--directorio');
  const salida = valor('--salida');
  if (!directorio || !salida) {
    throw new Error('Uso: node infra/superset/empaquetar-dashboards.mjs --directorio <carpeta> --salida <paquete.zip>');
  }
  const paquete = await empaquetarDashboards({
    directorio,
    variables: { SUPERSET_ANALITICA_DB_HOST: process.env.SUPERSET_ANALITICA_DB_HOST },
  });
  await writeFile(salida, paquete);
  console.log(`Paquete ${salida} generado (${paquete.length} bytes).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
