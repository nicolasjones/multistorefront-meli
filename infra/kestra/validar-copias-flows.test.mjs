// Contrato estático de los flows de copias (épica MSF-457, F-OPS-01):
// estructura, aviso por correo en `errors:`, variables definidas y la lógica
// de retención (30 diarias + 12 mensuales, nunca la última). No reemplaza el
// simulacro de restauración en un Kestra real (docs/simulacro-restauracion.md).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FLOWS = ['respaldo-postgres', 'respaldo-imagenes', 'retencion-copias', 'verificar-restauracion', 'aviso-fallo-copias', 'alerta-ausencia-respaldos', 'purgar-almacenamiento-kestra'];
const CON_AVISO = ['respaldo-postgres', 'respaldo-imagenes', 'retencion-copias', 'verificar-restauracion', 'alerta-ausencia-respaldos', 'purgar-almacenamiento-kestra'];
const leer = async (file) => (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
const flow = (id) => leer(`infra/kestra/flows/${id}.yml`);

test('los flows de copias viven en platform.backups y su id coincide con el archivo', async () => {
  for (const id of FLOWS) {
    const content = await flow(id);
    assert.match(content, new RegExp(`^id: ${id}$`, 'm'), `${id}: id`);
    assert.match(content, /^namespace: platform\.backups$/m, `${id}: namespace`);
  }
});

test('todo fallo avisa al soporte vía el subflow de correo', async () => {
  for (const id of CON_AVISO) {
    const content = await flow(id);
    const errors = content.slice(content.search(/^errors:$/m));
    assert.ok(errors.startsWith('errors:'), `${id}: falta el bloque errors:`);
    assert.match(errors, /type: io\.kestra\.plugin\.core\.flow\.Subflow/, `${id}: el aviso debe ser un Subflow`);
    assert.match(errors, /flowId: aviso-fallo-copias/, `${id}: debe invocar aviso-fallo-copias`);
    assert.match(errors, new RegExp(`flujo: ${id}`), `${id}: debe informar su propio id`);
    assert.match(errors, /errorLogs\(\)\[0\]\['message'\]/, `${id}: debe pasar el motivo real`);
  }
  const aviso = await flow('aviso-fallo-copias');
  assert.match(aviso, /type: io\.kestra\.plugin\.notifications\.mail\.MailSend/);
  assert.match(aviso, /to: "\{\{ envs\.soporte_correo \}\}"/);
  assert.match(aviso, /inputs\.motivo \| escape/, 'el motivo se escapa antes de ir en el HTML del correo');
});

test('registrar el error nunca impide el aviso', async () => {
  for (const id of ['respaldo-postgres', 'respaldo-imagenes', 'verificar-restauracion']) {
    const content = await flow(id);
    assert.match(content, /- id: finalizar_\w+_error\n\s+type: io\.kestra\.plugin\.jdbc\.postgresql\.Query\n\s+allowFailure: true/, `${id}: el registro del error debe tener allowFailure`);
  }
});

test('respaldo-postgres conserva el contrato de la spec 011 y guarda además en el destino', async () => {
  const content = await flow('respaldo-postgres');
  for (const tarea of ['iniciar_respaldo', 'pg_dump', 'verificar_respaldo', 'finalizar_respaldo_completado']) {
    assert.match(content, new RegExp(`- id: ${tarea}$`, 'm'), `falta ${tarea}`);
  }
  const copiar = content.indexOf('- id: copiar_a_destino');
  assert.ok(copiar > content.indexOf('- id: verificar_respaldo'), 'la copia al destino va después de la verificación');
  assert.ok(copiar < content.indexOf('- id: finalizar_respaldo_completado'), 'y antes de dar la copia por completada');
  assert.match(content, /ubicacion: "\{\{ outputs\.copiar_a_destino\.vars\.ubicacion \}\}"/);
  assert.match(content, /cron: "0 3 \* \* \*"/);
});

test('respaldo-imagenes copia Storage al destino y registra cantidad y tamaño', async () => {
  const content = await flow('respaldo-imagenes');
  assert.match(content, /rclone copy storage: "\{\{ vars\.destino \}\}"/);
  assert.match(content, /iniciar_respaldo_imagenes\(:origen\)/);
  assert.match(content, /finalizar_respaldo_imagenes_completado\(CAST\(:id AS bigint\), CAST\(:cantidad AS bigint\), CAST\(:bytes AS bigint\), :ubicacion\)/);
  assert.match(content, /limpiar_copia_parcial/, 'una foto a medias se borra al fallar');
  assert.match(content, /cron: "15 3 \* \* \*"/);
});

test('verificar-restauracion restaura aislada: sin red y sin tocar el entorno operativo', async () => {
  const content = await flow('verificar-restauracion');
  assert.match(content, /networkMode: none/);
  assert.match(content, /listen_addresses=/, 'sin puerto TCP');
  assert.doesNotMatch(content, /kestra_backups_pgdump_url/, 'no usa la cadena del Postgres operativo');
  assert.match(content, /iniciar_verificacion_restauracion\(\)/);
  assert.match(content, /finalizar_verificacion_completado\(CAST\(:id AS bigint\), CAST\(:duracion AS integer\), :detalle\)/);
  assert.match(content, /finalizar_verificacion_error\(CAST\(:id AS bigint\), :motivo\)/);
});

test('toda variable envs.* de los flows de copias está en el compose y en los .env.example', async () => {
  const compose = await leer('infra/kestra/compose.yaml');
  const ejemplos = [await leer('.env.example'), await leer('infra/kestra/.env.example')];
  const usadas = new Set();
  for (const id of FLOWS) {
    for (const m of (await flow(id)).matchAll(/envs\.([a-z0-9_]+)/g)) usadas.add(m[1]);
  }
  for (const nombre of usadas) {
    const env = nombre.toUpperCase();
    assert.match(compose, new RegExp(`ENV_${env}:`), `${env} no está en infra/kestra/compose.yaml`);
    assert.match(ejemplos[0], new RegExp(`^${env}=`, 'm'), `${env} no está en .env.example`);
  }
  // Las de la spec 011 (kestra_backups_*) ya vivían solo en el .env.example raíz.
  for (const env of [...usadas].map((n) => n.toUpperCase()).filter((n) => !n.startsWith('KESTRA_BACKUPS_'))) {
    assert.match(ejemplos[1], new RegExp(`^${env}=`, 'm'), `${env} no está en infra/kestra/.env.example`);
  }
});

test('los .env.example no traen secretos reales', async () => {
  for (const file of ['.env.example', 'infra/kestra/.env.example']) {
    const content = await leer(file);
    for (const m of content.matchAll(/^(RESPALDOS_\w*(?:SECRET|PASS|KEY)\w*|KESTRA_SMTP_PASSWORD)=(.*)$/gm)) {
      assert.match(m[2], /^(|change-me-local)$/, `${file}: ${m[1]} debe ir vacío o ser un placeholder`);
    }
  }
});

test('la retención es por días (no por cantidad), con meses y tope, y nunca borra la última copia', async () => {
  const content = await flow('retencion-copias');
  const inicio = content.indexOf('purgar() {');
  assert.notEqual(inicio, -1, 'falta la función purgar');
  const fin = content.indexOf('\n        }\n', inicio);
  const funcion = content.slice(inicio, fin + '\n        }\n'.length).replace(/^ {8}/gm, '');
  assert.match(content, /purgar imagenes --dirs-only "\$IMAGENES_DIAS" "\$IMAGENES_MENSUALES" "\$IMAGENES_MAX"/, 'las imágenes completas tienen plazo y tope propios');
  assert.doesNotMatch(content, /retencion_diarias/i, 'la retención ya no es por cantidad');

  const AHORA = String(Date.UTC(2026, 9, 18, 4, 30) / 1000);
  // rclone simulado: `lsf` lista los nombres (o falla con `codigo`); `deletefile` imprime el borrado.
  const correr = (nombres, dias, mensuales, max = 0, codigo = 0) => {
    const rclone = `rclone() { if [ "$1" = lsf ]; then [ ${codigo} -eq 0 ] || return ${codigo}; printf '%s\\n' ${nombres.map((n) => `'${n}'`).join(' ')}; else echo "BORRA \${2##*/}"; fi; }`;
    const script = `set -eu\nBORRADOS=0\nLISTA_TMP=$(mktemp)\n${funcion}\n${rclone}\npurgar base --files-only ${dias} ${mensuales} ${max}`;
    return execFileSync('sh', ['-c', script], { env: { ...process.env, RAIZ: 'respaldos:/x', AHORA }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  };
  const purgar = (nombres, dias, mensuales, max = 0) =>
    correr(nombres, dias, mensuales, max).split('\n').filter((l) => l.startsWith('BORRA ')).map((l) => l.slice(6));

  // 400 días consecutivos hasta 2026-10-18, una copia por día.
  const dias = [];
  for (let i = 399; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(2026, 9, 18) - i * 86400000);
    dias.push(`${d.toISOString().slice(0, 10).replaceAll('-', '')}-030000-1.dump`);
  }
  const purgadas = new Set(purgar(dias, 30, 12));
  const conservadas = dias.filter((n) => !purgadas.has(n));
  assert.ok(!purgadas.has(dias.at(-1)), 'nunca se borra la copia más reciente');
  // Corte: hoy (18/10) menos 30 días = 18/09; se conservan las copias de esa fecha en adelante.
  for (const n of dias.filter((x) => x.slice(0, 8) >= '20260918')) assert.ok(!purgadas.has(n), `las copias de los últimos 30 días se conservan (${n})`);
  const meses = [...new Set(dias.map((n) => n.slice(0, 6)))].slice(-12);
  for (const mes of meses) assert.ok(!purgadas.has(dias.find((n) => n.startsWith(mes))), `la primera copia de ${mes} se conserva`);
  assert.ok(purgadas.has(dias[0]), 'lo más viejo que no es mensual reciente se purga');
  assert.ok(conservadas.length <= 31 + 12, `se conserva a lo sumo 31 días + 12 meses (quedaron ${conservadas.length})`);

  // La retención es por días: varias copias el mismo día se conservan todas; las viejas se purgan aunque sean pocas.
  assert.deepEqual(purgar(['20261018-010000-1.dump', '20261018-020000-2.dump', '20261018-030000-3.dump'], 1, 0), []);
  assert.deepEqual(purgar(['20260901-030000-1.dump', '20260902-030000-2.dump', '20261018-030000-3.dump'], 7, 0), ['20260901-030000-1.dump', '20260902-030000-2.dump']);
  // Tope: de las fotos dentro del plazo se conservan solo las `max` más nuevas.
  const fotos = ['20261012', '20261013', '20261014', '20261015', '20261016', '20261017', '20261018'].map((d) => `${d}-031500`);
  assert.deepEqual(purgar(fotos, 7, 0, 3), fotos.slice(0, 4));
  // Aunque todo esté fuera de plazo, la última copia se conserva.
  assert.deepEqual(purgar(['20250101-030000-1.dump', '20250102-030000-2.dump'], 1, 0), ['20250101-030000-1.dump']);

  // Con una sola copia no se borra nada; archivos ajenos al patrón se ignoran.
  assert.deepEqual(purgar(['20261018-030000-1.dump'], 1, 0), []);
  assert.deepEqual(purgar(['20261017-030000-1.dump', '20261018-030000-2.dump', 'lost+found', 'notas.txt'], 1, 0), []);
  assert.deepEqual(purgar(['20261001-030000-1.dump', '20261018-030000-2.dump', 'lost+found', 'notas.txt'], 1, 0), ['20261001-030000-1.dump']);

  // Un nombre con espacios no se parte: se borra entero, nunca un fragmento ajeno.
  assert.deepEqual(purgar(['20261001-030000 foo', '20261018-030000-2.dump'], 1, 0), ['20261001-030000 foo']);
  // Un destino inalcanzable falla la tarea en vez de informar «0 purgadas».
  assert.throws(() => correr(['20261018-030000-1.dump'], 1, 0, 0, 1), /Command failed/);
  // Una carpeta que aún no existe (código 3) es vacía, no un error.
  assert.deepEqual(correr([], 1, 0, 0, 3).split('\n').filter(Boolean), []);
});
