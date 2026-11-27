// Guard de MSF-648: ningún Compose del repo publica un puerto en TODAS las interfaces (0.0.0.0) ni usa `network_mode: host`.
// Postgres, Studio, Kong, Inbucket/Mailpit, Kestra, Superset, Nango, GlitchTip y el resto de los servicios sensibles solo pueden
// escuchar en loopback (127.0.0.1/::1) o en la IP de Tailscale (100.64.0.0/10); el acceso desde afuera va por el proxy inverso con TLS.
// También revisa los `docker run -p`/`--publish` escritos en scripts, package.json y workflows.
//
// Reconoce la sintaxis corta (`"127.0.0.1:8085:8080"`, `${VAR:-127.0.0.1}:80:80`) y la larga (`published`/`host_ip`).
// Uso: node scripts/verificar-compose-puertos.mjs [raíz]. Sale 1 con la lista de hallazgos.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ¿Es `ip` una dirección acotada (loopback o Tailscale)? Se aceptan `${VAR:-valor}` si el VALOR por defecto lo es.
export function ipAcotada(ip) {
  let v = String(ip).trim();
  const porDefecto = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}$/.exec(v);
  if (porDefecto) v = porDefecto[1];
  else if (v.startsWith('${')) return false; // una variable sin valor por defecto puede quedar vacía = 0.0.0.0
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v === '::1' || v === 'localhost') return true;
  const partes = v.split('.');
  if (partes.length !== 4 || partes.some((p) => p === '' || !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = partes.map(Number);
  return a === 127 || (a === 100 && b >= 64 && b <= 127);
}

// Separa `ip:host:contenedor` respetando `[::1]` y `${VAR:-x}`. Devuelve { ip|null, resto }.
export function separarPuerto(entrada) {
  let texto = String(entrada).trim();
  if (texto.length >= 2 && (texto[0] === '"' || texto[0] === "'") && texto.at(-1) === texto[0]) texto = texto.slice(1, -1);
  texto = texto.replace(/\/(tcp|udp|sctp)$/i, '');
  const partes = [];
  let actual = '';
  let llaves = 0;
  let corchetes = 0;
  for (const c of texto) {
    if (c === '{') llaves += 1;
    else if (c === '}') llaves -= 1;
    else if (c === '[') corchetes += 1;
    else if (c === ']') corchetes -= 1;
    if (c === ':' && llaves === 0 && corchetes === 0) { partes.push(actual); actual = ''; } else actual += c;
  }
  partes.push(actual);
  // 1 parte: solo puerto del contenedor (publica en un puerto efímero en 0.0.0.0). 2: host:contenedor. 3: ip:host:contenedor.
  return partes.length >= 3 ? { ip: partes[0], restante: partes.slice(1).join(':') } : { ip: null, restante: texto };
}

export function hallazgoDePuerto(entrada) {
  const { ip } = separarPuerto(entrada);
  if (ip === null) return 'publica en todas las interfaces (falta la IP: usá "127.0.0.1:puerto:puerto")';
  if (!ipAcotada(ip)) return ip === '' || ip === '0.0.0.0' || ip === '::' || ip === '[::]' ? 'publica en todas las interfaces (0.0.0.0)' : `publica en una IP no acotada (${ip}): solo loopback o Tailscale`;
  return null;
}

const indentacion = (linea) => linea.length - linea.trimStart().length;

// Recorre un Compose y devuelve los hallazgos con número de línea. Sintaxis corta y larga; `ports: !reset []` no publica nada.
export function analizarCompose(nombre, texto) {
  const hallazgos = [];
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i];
    const sinComentario = linea.trimStart().startsWith('#') ? '' : linea;
    if (/^\s*network_mode:\s*["']?host["']?\s*(#.*)?$/.test(sinComentario)) hallazgos.push(`${nombre}:${i + 1}: network_mode: host expone todos los puertos del servicio en el host.`);
    const m = /^(\s*)ports:\s*(.*)$/.exec(sinComentario);
    if (!m) continue;
    const resto = m[2].replace(/#.*$/, '').trim();
    if (resto.startsWith('!reset') || resto === '[]') continue;
    if (resto.startsWith('[')) {
      // Lista en línea: ports: ["8080:80", "127.0.0.1:81:81"]
      for (const parte of resto.slice(1, resto.lastIndexOf(']')).split(',')) {
        const motivo = parte.trim() === '' ? null : hallazgoDePuerto(parte);
        if (motivo) hallazgos.push(`${nombre}:${i + 1}: ${parte.trim()} ${motivo}.`);
      }
      continue;
    }
    const base = indentacion(linea);
    let largo = null; // elemento de sintaxis larga en curso: { linea, published, host_ip }
    const cerrarLargo = () => {
      if (largo && largo.published && (largo.host_ip === undefined || !ipAcotada(largo.host_ip))) {
        hallazgos.push(`${nombre}:${largo.linea}: puerto ${largo.published} ${largo.host_ip === undefined ? 'sin host_ip: publica en todas las interfaces' : `con host_ip ${largo.host_ip} no acotada`}.`);
      }
      largo = null;
    };
    let j = i + 1;
    for (; j < lineas.length; j += 1) {
      const l = lineas[j];
      if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
      if (indentacion(l) <= base && !l.trimStart().startsWith('- ')) break;
      if (indentacion(l) < base) break;
      const item = l.trimStart().startsWith('- ') ? l.trimStart().slice(2).replace(/\s+#.*$/, '').trim() : null;
      if (item !== null) {
        cerrarLargo();
        const clave = /^(published|target|host_ip|protocol|mode):\s*(.*)$/.exec(item);
        if (clave) { largo = { linea: j + 1 }; if (clave[1] === 'published') largo.published = clave[2]; if (clave[1] === 'host_ip') largo.host_ip = clave[2].replace(/^["']|["']$/g, ''); continue; }
        const motivo = hallazgoDePuerto(item);
        if (motivo) hallazgos.push(`${nombre}:${j + 1}: ${item} ${motivo}.`);
      } else if (largo) {
        const clave = /^\s*(published|host_ip):\s*(.*?)\s*(#.*)?$/.exec(l);
        if (clave?.[1] === 'published') largo.published = clave[2];
        if (clave?.[1] === 'host_ip') largo.host_ip = clave[2].replace(/^["']|["']$/g, '');
      }
    }
    cerrarLargo();
    i = j - 1;
  }
  return hallazgos;
}

// Une las continuaciones de línea de shell (`\` al final): `docker run \` con el `-p` en la línea siguiente es UN solo comando. Devuelve
// [{ numero, texto }] con el número de la primera línea de cada comando lógico.
export function lineasLogicas(texto) {
  const salida = [];
  let actual = null;
  texto.split('\n').forEach((linea, i) => {
    const continua = linea.endsWith('\\');
    const contenido = continua ? linea.slice(0, -1) : linea;
    if (actual) { actual.texto += ` ${contenido.trim()}`; } else { actual = { numero: i + 1, texto: contenido }; }
    if (!continua) { salida.push(actual); actual = null; }
  });
  if (actual) salida.push(actual);
  return salida;
}

// `docker run`/`docker create` con -p/--publish sin IP, en scripts, package.json y workflows (también con el `-p` en una línea de continuación).
export function analizarComandos(nombre, texto) {
  const hallazgos = [];
  for (const { numero, texto: linea } of lineasLogicas(texto)) {
    if (!/docker (run|create)\b/.test(linea)) continue;
    const unidas = linea.replaceAll('\\"', '"');
    for (const m of unidas.matchAll(/(?:^|\s)(?:-p|--publish)(?:\s+|=)["']?([^\s"']+)/g)) {
      const motivo = hallazgoDePuerto(m[1]);
      if (motivo) hallazgos.push(`${nombre}:${numero}: comando docker con -p ${m[1]} ${motivo}.`);
    }
  }
  return hallazgos;
}

function* archivos(directorio, aceptar) {
  for (const e of readdirSync(directorio)) {
    if (e === 'node_modules' || e === '.git') continue;
    const ruta = path.join(directorio, e);
    if (statSync(ruta).isDirectory()) yield* archivos(ruta, aceptar);
    else if (aceptar(ruta)) yield ruta;
  }
}

export function analizarRaiz(raiz) {
  const hallazgos = [];
  const rel = (ruta) => path.relative(raiz, ruta).split(path.sep).join('/');
  for (const ruta of archivos(path.join(raiz, 'infra'), (r) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/.test(r.split(path.sep).join('/')))) hallazgos.push(...analizarCompose(rel(ruta), readFileSync(ruta, 'utf8')));
  const comandos = [path.join(raiz, 'package.json')];
  for (const sub of ['scripts', '.github']) {
    try { comandos.push(...archivos(path.join(raiz, sub), (r) => /\.(sh|mjs|ya?ml)$/.test(r) && !r.endsWith('.test.mjs'))); } catch { /* el directorio no existe en un repo de prueba */ }
  }
  for (const ruta of comandos) {
    try { hallazgos.push(...analizarComandos(rel(ruta), readFileSync(ruta, 'utf8'))); } catch { /* sin package.json en un repo de prueba */ }
  }
  return hallazgos;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const raiz = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hallazgos = analizarRaiz(raiz);
  for (const h of hallazgos) console.error(h);
  if (hallazgos.length > 0) process.exit(1);
  console.log('Compose: ningún puerto se publica fuera de loopback/Tailscale ni se usa network_mode: host.');
}
