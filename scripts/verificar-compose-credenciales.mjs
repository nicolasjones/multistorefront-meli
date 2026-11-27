// Guard de MSF-705: toda credencial del Compose de un producto que se despliega al VPS con un valor por defecto público
// (`${VAR:-change-me-local}`, `postgres:postgres@...`, claves fijas) tiene que ser OBLIGATORIA en `compose.estricto.yaml`
// (`${VAR:?mensaje}`), que `scripts/deploy-vps.mjs` suma en staging y producción. Sin eso, si falta la variable en el `.env` del
// VPS el servicio arranca con una credencial conocida. Los Compose sin overlay (glitchtip, mcp-server, refine, playwright) no
// pueden traer ninguna.
//
// Uso: node scripts/verificar-compose-credenciales.mjs [raíz] (por defecto la raíz del repo). Sale 1 con la lista de hallazgos.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { motivoPorDefecto } from './secretos-por-defecto.mjs';

// Claves PÚBLICAS (la anon de Supabase que viaja al cliente): un valor de ejemplo no abre nada, solo hace fallar la llamada.
export const EXENTAS = new Set(['AVISOS_REPOSICION_APIKEY', 'RESUMEN_SEMANAL_APIKEY', 'ALERTAS_INICIO_APIKEY', 'AVISOS_FALTANTES_APIKEY']);

// Recorre `${NOMBRE:-defecto}` y `${NOMBRE:?mensaje}` con anidamiento (`${A:-x${B:-1}y}`). Devuelve [{ nombre, operador, valor }].
export function interpolaciones(texto) {
  const salida = [];
  let i = 0;
  while (i < texto.length) {
    const inicio = texto.indexOf('${', i);
    if (inicio === -1) break;
    let profundidad = 1;
    let j = inicio + 2;
    while (j < texto.length && profundidad > 0) {
      if (texto[j] === '$' && texto[j + 1] === '{') { profundidad += 1; j += 2; continue; }
      if (texto[j] === '}') profundidad -= 1;
      j += 1;
    }
    if (profundidad !== 0) break;
    const cuerpo = texto.slice(inicio + 2, j - 1);
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(:-|:\?|-|\?)?([\s\S]*)$/.exec(cuerpo);
    if (m) salida.push({ nombre: m[1], operador: m[2] ?? '', valor: m[3] });
    // Seguir DENTRO del cuerpo para encontrar las interpolaciones anidadas.
    i = inicio + 2;
  }
  return salida;
}

// Quita las interpolaciones anidadas de un valor por defecto para poder analizarlo como URL (`:${PUERTO:-7634}/` -> `:0/`).
function sinAnidadas(valor) {
  let salida = '';
  let profundidad = 0;
  for (let i = 0; i < valor.length; i += 1) {
    if (valor[i] === '$' && valor[i + 1] === '{') { profundidad += 1; if (profundidad === 1) salida += '0'; i += 1; continue; }
    if (valor[i] === '}' && profundidad > 0) { profundidad -= 1; continue; }
    if (profundidad === 0) salida += valor[i];
  }
  return salida;
}

// Variables con un valor por defecto PÚBLICO en `texto` (el Compose base de un producto).
export function conDefectoPublico(texto) {
  const nombres = new Map();
  for (const { nombre, operador, valor } of interpolaciones(texto)) {
    if (operador !== ':-' && operador !== '-') continue;
    if (EXENTAS.has(nombre)) continue;
    const motivo = motivoPorDefecto(nombre, sinAnidadas(valor));
    if (motivo && !nombres.has(nombre)) nombres.set(nombre, motivo);
  }
  return nombres;
}

// Variables con `:?` (obligatorias) en `texto` (el overlay estricto).
export function obligatorias(texto) {
  return new Set(interpolaciones(texto).filter((x) => x.operador === ':?' || x.operador === '?').map((x) => x.nombre));
}

// Literales (sin interpolación) con un valor público en variables sensibles: `POSTGRES_PASSWORD: postgres`, `- KESTRA_X=change-me-local`. Una credencial
// fija en el Compose se despliega igual en todos los ambientes: no puede quedar con un valor por defecto conocido.
export function literalesPublicos(texto) {
  const nombres = new Map();
  for (const linea of texto.split('\n')) {
    if (linea.trimStart().startsWith('#')) continue;
    const m = /^\s*(?:-\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s+|=)(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
    if (valor === '' || valor.includes('${')) continue;
    const motivo = motivoPorDefecto(m[1], valor);
    if (motivo && !nombres.has(m[1])) nombres.set(m[1], motivo);
  }
  return nombres;
}

export function analizarProducto(producto, base, estricto) {
  const hallazgos = [];
  for (const [nombre, motivo] of literalesPublicos(base)) hallazgos.push(`infra/${producto}/compose.yaml: ${nombre} tiene un valor LITERAL por defecto (${motivo}): usá \${${nombre}:?...} o un valor que venga del entorno.`);
  const defectos = conDefectoPublico(base);
  if (estricto === null) {
    for (const [nombre, motivo] of defectos) hallazgos.push(`infra/${producto}/compose.yaml: ${nombre} trae un valor por defecto (${motivo}) y el producto no tiene compose.estricto.yaml.`);
    return hallazgos;
  }
  const exigidas = obligatorias(estricto);
  for (const [nombre, motivo] of defectos) {
    if (!exigidas.has(nombre)) hallazgos.push(`infra/${producto}/compose.estricto.yaml: ${nombre} no es obligatoria (\${${nombre}:?}) y el Compose base la deja con un valor por defecto (${motivo}).`);
  }
  for (const { nombre, operador, valor } of interpolaciones(estricto)) {
    if ((operador === ':-' || operador === '-') && motivoPorDefecto(nombre, sinAnidadas(valor))) hallazgos.push(`infra/${producto}/compose.estricto.yaml: ${nombre} trae un valor por defecto público dentro del overlay estricto.`);
  }
  return hallazgos;
}

export function analizarRaiz(raiz) {
  const infra = path.join(raiz, 'infra');
  const hallazgos = [];
  for (const producto of readdirSync(infra, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const base = path.join(infra, producto, 'compose.yaml');
    if (!existsSync(base)) continue;
    const estricto = path.join(infra, producto, 'compose.estricto.yaml');
    hallazgos.push(...analizarProducto(producto, readFileSync(base, 'utf8'), existsSync(estricto) ? readFileSync(estricto, 'utf8') : null));
  }
  return hallazgos;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const raiz = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hallazgos = analizarRaiz(raiz);
  for (const h of hallazgos) console.error(h);
  if (hallazgos.length > 0) process.exit(1);
  console.log('Compose: toda credencial con valor por defecto público es obligatoria en el overlay estricto.');
}
