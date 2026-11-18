// Ejecuta de verdad la lógica de shell de los flows de copias (extraída del YAML), sin red ni Docker: la alerta de ausencia, la
// validación de plazos de la retención y la clasificación de errores de la restauración. Los tests por regex no habrían detectado
// que `rclone lsf --max-age` no filtra directorios (MSF-709) ni que `su-exec` no existe en la imagen de Postgres (MSF-708).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const flow = (id) => readFileSync(`infra/kestra/flows/${id}.yml`, 'utf8').replace(/\r\n/g, '\n');
const indent = (l) => l.search(/\S/);

// Devuelve el texto del comando de `commands:` (ítem de lista a 6 espacios) que contiene `marcador`.
function comando(texto, marcador) {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => l.includes(marcador));
  assert.notEqual(i, -1, `no se encontró ${marcador}`);
  let ini = i;
  while (!/^ {6}- /.test(lineas[ini])) ini -= 1;
  if (!/^ {6}- \|\s*$/.test(lineas[ini])) return lineas[ini].replace(/^ {6}- /, '');
  const cuerpo = [];
  for (let k = ini + 1; k < lineas.length; k += 1) {
    if (lineas[k].trim() && indent(lineas[k]) < 8) break;
    cuerpo.push(lineas[k].slice(8));
  }
  return cuerpo.join('\n');
}
const correr = (script, env = {}) => spawnSync('sh', ['-c', `set -eu\n${script}`], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

// --- alerta-ausencia-respaldos ---

const ausencia = flow('alerta-ausencia-respaldos');
const AHORA = String(Date.UTC(2026, 10, 17, 9, 0) / 1000); // 2026-11-17 09:00 UTC
const rcloneFalso = `rclone() { case "$3" in --files-only) printf '%s\\n' $LISTA_BASE ;; --dirs-only) printf '%s\\n' $LISTA_IMAGENES ;; esac; [ "\${RC_LISTA:-0}" -eq 0 ] || return "$RC_LISTA"; }`;
function alerta(base, imagenes, horas = '30', extra = {}) {
  const script = `${rcloneFalso}\nHORAS=${horas}\nRAIZ=respaldos:/x\n${comando(ausencia, 'case "$HORAS" in')}\n${comando(ausencia, 'FALTAN=')}`;
  return correr(script, { LISTA_BASE: base.join(' '), LISTA_IMAGENES: imagenes.join(' '), AHORA, ...extra });
}

test('la alerta de ausencia ve una carpeta de imágenes vieja como ausente y una reciente como presente', () => {
  const base = ['20261117-030000-1.dump'];
  const vieja = alerta(base, ['20200101-031500/']);
  assert.equal(vieja.status, 1);
  assert.match(vieja.stderr, /no hay foto de imágenes/);
  assert.doesNotMatch(vieja.stderr, /copia de la base/);
  const mezcla = alerta(base, ['20200101-031500/', '20261117-031500/']);
  assert.equal(mezcla.status, 0, mezcla.stderr);
  assert.match(mezcla.stdout, /base=1, imágenes=1/);
});

test('la alerta de ausencia detecta la base ausente, ambas ausentes y el destino inalcanzable', () => {
  assert.match(alerta(['20261110-030000-1.dump'], ['20261117-031500/']).stderr, /no hay copia de la base/);
  assert.match(alerta([], []).stderr, /copia de la base; foto de imágenes/);
  const caido = alerta(['20261117-030000-1.dump'], ['20261117-031500/'], '30', { RC_LISTA: '1' });
  assert.equal(caido.status, 1);
  assert.match(caido.stderr, /No se pudo listar/);
  // Una carpeta que no existe (código 3) cuenta como vacía.
  assert.match(alerta([], [], '30', { RC_LISTA: '3' }).stderr, /Ausencia de respaldos/);
});

test('la ventana en horas se respeta en el borde y rechaza valores inválidos', () => {
  // A las 09:00 con 6 h el corte es 03:00: la copia de las 03:00 entra; la de 02:59:59 no.
  assert.equal(alerta(['20261117-030000-1.dump'], ['20261117-030000/'], '6').status, 0);
  assert.equal(alerta(['20261117-025959-1.dump'], ['20261117-030000/'], '6').status, 1);
  for (const malo of ['0', '', '08', '-1', 'abc', '1.5', '99999', '99999999999999999999']) {
    const r = alerta(['20261117-030000-1.dump'], ['20261117-031500/'], `'${malo}'`);
    assert.equal(r.status, 1, `horas=${malo}`);
    assert.match(r.stderr, /RESPALDOS_AUSENCIA_HORAS debe ser un entero/);
  }
});

// --- retencion-copias: plazos ---

const retencion = flow('retencion-copias');
function plazos(env) {
  return correr(comando(retencion, 'numero() {'), { DIAS: '30', MENSUALES: '12', IMAGENES_DIAS: '7', IMAGENES_MENSUALES: '2', IMAGENES_MAX: '7', ...env });
}

test('la retención valida los plazos con mensajes claros: «08», vacío, 0 y texto no pasan', () => {
  assert.equal(plazos({}).status, 0);
  assert.equal(plazos({ MENSUALES: '0', IMAGENES_MENSUALES: '0' }).status, 0, 'los meses admiten 0');
  for (const [variable, valor, esperado] of [['DIAS', '08', /RESPALDOS_RETENCION_DIAS debe ser un entero >= 1 sin ceros/], ['DIAS', '0', /un entero >= 1/], ['DIAS', '', /un entero >= 1/], ['IMAGENES_DIAS', 'x', /RESPALDOS_IMAGENES_RETENCION_DIAS/], ['IMAGENES_MAX', '0', /RESPALDOS_IMAGENES_MAX_COPIAS debe ser un entero >= 1/], ['MENSUALES', '-1', /RESPALDOS_RETENCION_MENSUALES debe ser un entero >= 0/], ['MENSUALES', '08', /sin ceros a la izquierda/]]) {
    const r = plazos({ [variable]: valor });
    assert.equal(r.status, 1, `${variable}=${valor}`);
    assert.match(r.stderr, esperado, `${variable}=${valor}`);
  }
});

test('la retención rechaza más de 4 dígitos (desborde en BusyBox) y valores con salto de línea, y acepta 9999', () => {
  assert.equal(plazos({ DIAS: '9999', MENSUALES: '9999', IMAGENES_DIAS: '9999', IMAGENES_MAX: '9999' }).status, 0, '9999 es el máximo válido');
  for (const variable of ['DIAS', 'MENSUALES', 'IMAGENES_DIAS', 'IMAGENES_MENSUALES', 'IMAGENES_MAX']) {
    for (const valor of ['10000', '99999999999999999999', '5\nabc', 'abc\n5', '5\n']) {
      const r = plazos({ [variable]: valor });
      assert.equal(r.status, 1, `${variable}=${JSON.stringify(valor)}`);
      assert.match(r.stderr, /debe ser un entero/, `${variable}=${JSON.stringify(valor)}`);
    }
  }
});

function purgarImagenes(dias, mensuales, tope) {
  const inicio = retencion.indexOf('purgar() {');
  const fin = retencion.indexOf('\n        }\n', inicio);
  const funcion = retencion.slice(inicio, fin + '\n        }\n'.length).replace(/^ {8}/gm, '');
  const nombres = [];
  for (let m = 0; m < 6; m += 1) nombres.push(`2026${String(5 + m).padStart(2, '0')}01-031500`); // 1.º de mayo..octubre
  for (let d = 12; d <= 18; d += 1) nombres.push(`202611${d}-031500`.replace('202611', '202611'));
  const rclone = `rclone() { if [ "$1" = lsf ]; then printf '%s\\n' ${nombres.map((n) => `'${n}'`).join(' ')}; else echo "BORRA \${2##*/}"; fi; }`;
  const r = correr(`BORRADOS=0\nLISTA_TMP=$(mktemp)\n${funcion}\n${rclone}\npurgar imagenes --dirs-only ${dias} ${mensuales} ${tope}`, { RAIZ: 'respaldos:/x', AHORA: String(Date.UTC(2026, 10, 18, 4, 30) / 1000) });
  assert.equal(r.status, 0, r.stderr);
  const borradas = new Set(r.stdout.split('\n').filter((l) => l.startsWith('BORRA ')).map((l) => l.slice(6)));
  return nombres.filter((n) => !borradas.has(n));
}

test('el tope de imágenes cuenta todo: días y mensuales juntas, y la última siempre queda', () => {
  const conservadas = purgarImagenes(7, 4, 7);
  assert.ok(conservadas.length <= 7, `con tope 7 quedaron ${conservadas.length}`);
  assert.ok(conservadas.includes('20261118-031500'), 'la más reciente siempre queda');
});

test('el tope de imágenes también corta en el bucle de días (más días vigentes que el tope, sin mensuales)', () => {
  // 7 copias dentro de la ventana de 7 días y tope 3: si el tope no se aplicara al bucle de días quedarían 7.
  const conservadas = purgarImagenes(7, 0, 3);
  assert.equal(conservadas.length, 3, `con tope 3 quedaron ${conservadas.length}`);
  assert.deepEqual(conservadas, ['20261116-031500', '20261117-031500', '20261118-031500'], 'se conservan las más nuevas');
});


// --- verificar-restauracion: clasificación de errores sin mostrar datos ---

const restauracion = flow('verificar-restauracion');
function clasificar(lineas, rc = 1) {
  const dir = mkdtempSync(path.join(tmpdir(), 'restore-'));
  const err = path.join(dir, 'restore.err');
  writeFileSync(err, `${lineas.join('\n')}\n`);
  const patron = restauracion.match(/PATRON_ESPERADOS='(.+)'\n/)[1];
  const script = `PATRON_ESPERADOS='${patron}'\nRC_RESTORE=${rc}\n${comando(restauracion, 'ERR_FILE="${ERR_FILE')}\n${comando(restauracion, 'ERRORES=$(grep')}\n${comando(restauracion, 'INESPERADOS=$(grep')}\n${comando(restauracion, 'if [ -n "$INESPERADOS" ]')}\necho "esperados=$ERRORES"`;
  return correr(script, { ERR_FILE: err });
}

test('verificar-restauracion acepta solo errores esperados, falla con otros y NUNCA imprime el texto de los datos', () => {
  const esperados = ['pg_restore: error: could not execute query: ERROR:  role "anon" does not exist', 'pg_restore: error: could not execute query: ERROR:  extension "pgsodium" is not available'];
  const ok = clasificar(esperados, 0);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /esperados=2/);

  const SECRETO = 'dni-27123456-clave-secreta';
  const mal = clasificar([...esperados, `pg_restore: error: COPY failed for table "clientes": ERROR:  invalid input syntax for type integer: "${SECRETO}"`, 'pg_restore: error: unexpected end of file'], 1);
  assert.equal(mal.status, 1);
  assert.match(mal.stderr, /datos_o_restricciones: 1/);
  assert.match(mal.stderr, /archivo_cortado_o_ilegible: 1/);
  assert.match(mal.stderr, /código 1/);
  assert.doesNotMatch(`${mal.stdout}${mal.stderr}`, new RegExp(SECRETO), 'el valor citado por pg_restore no se imprime');
  assert.doesNotMatch(`${mal.stdout}${mal.stderr}`, /clientes/, 'ni siquiera el nombre de la tabla del error crudo');
});

test('verificar-restauracion usa gosu (existe en postgres:17-alpine) y no su-exec (MSF-708)', () => {
  assert.doesNotMatch(restauracion, /su-exec/);
  assert.equal((restauracion.match(/gosu postgres/g) ?? []).length, 3);
});

// --- purgar-almacenamiento-kestra: el plazo se valida antes de borrar ---

test('purgar-almacenamiento-kestra exige un entero >= 1 sin ceros a la izquierda antes de purgar (0, vacío, negativo, texto y «08» no pasan)', () => {
  const t = flow('purgar-almacenamiento-kestra');
  const condicion = t.match(/- "\{\{ \(inputs\.dias \?\? envs\.kestra_retencion_ejecuciones_dias \?\? '7'\) matches '([^']+)' \}\}"/);
  assert.ok(condicion, 'falta la condición de validación del plazo');
  const re = new RegExp(condicion[1]);
  for (const bueno of ['1', '7', '30', '90']) assert.equal(re.test(bueno), true, bueno);
  for (const malo of ['0', '', '-1', 'abc', '08', '1.5', ' 7', '7 ']) assert.equal(re.test(malo), false, JSON.stringify(malo));
  assert.ok(t.indexOf('id: validar_plazo') < t.indexOf('id: purgar_ejecuciones_y_archivos'), 'se valida ANTES de purgar');
  assert.match(t, /type: io\.kestra\.plugin\.core\.execution\.Assert/);
});
