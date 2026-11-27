import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { comprobarConexion, conectarTcp, destinoDeUrl } from './comprobar-conexion-db.mjs';

test('destinoDeUrl: host y puerto; puerto por defecto; IPv6; rechaza lo que no es una URL de Postgres sin filtrar la URL', () => {
  assert.deepEqual(destinoDeUrl('postgresql://u:p@172.17.0.1:7635/postgres'), { host: '172.17.0.1', puerto: 7635 });
  assert.deepEqual(destinoDeUrl('postgres://u:p@db.ejemplo.com/postgres'), { host: 'db.ejemplo.com', puerto: 5432 });
  assert.deepEqual(destinoDeUrl('postgresql://u:p@[::1]:6000/x'), { host: '::1', puerto: 6000 });
  const secreto = 'ClaveSuperSecreta99';
  for (const mala of ['no es url', `https://u:${secreto}@h/x`, `mysql://u:${secreto}@h:1/x`, '']) {
    assert.throws(() => destinoDeUrl(mala), (e) => !e.message.includes(secreto) && /SUPABASE_DB_URL/.test(e.message), mala);
  }
});

test('comprobarConexion: conectado devuelve el destino; cada fallo lanza un mensaje accionable sin credenciales ni host, y enmascara el host', async () => {
  const previos = [];
  const ok = await comprobarConexion('postgresql://u:p@h:7635/x', 'staging', { conectar: async () => { assert.deepEqual(previos, ['h'], 'el host se enmascara ANTES de conectar'); return null; }, enmascarar: (v) => previos.push(v) });
  assert.deepEqual(ok, { host: 'h', puerto: 7635 });
  assert.deepEqual(previos, ['h'], 'también cuando conecta bien (B-6)');
  for (const motivo of ['ECONNREFUSED', 'timeout', 'EHOSTUNREACH']) {
    const enmascarados = [];
    await assert.rejects(comprobarConexion('postgresql://usuario:ClaveSecreta1@172.17.0.1:7635/x', 'staging', { conectar: async () => motivo, enmascarar: (v) => enmascarados.push(v) }), (e) => {
      assert.match(e.message, new RegExp(`puerto 7635\\) del Environment migraciones-cloud-staging: ${motivo}`));
      assert.match(e.message, /red dedicada/);
      assert.match(e.message, /puertos de base de datos/);
      assert.doesNotMatch(e.message, /bridge de Docker|localhost/, 'ya no afirma lo que contradecía al firewall');
      assert.ok(!e.message.includes('ClaveSecreta1') && !e.message.includes('usuario') && !e.message.includes('172.17.0.1'), 'sin credenciales ni host');
      return true;
    });
    assert.deepEqual(enmascarados, ['172.17.0.1'], 'el host se enmascara en el log de Actions');
  }
});

test('conectarTcp contra un servidor real: abierto null, cerrado ECONNREFUSED', async () => {
  const servidor = await new Promise((resolve) => { const s = net.createServer((c) => c.end()); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = servidor.address();
  assert.equal(await conectarTcp('127.0.0.1', port, 1000), null);
  servidor.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await conectarTcp('127.0.0.1', port, 1000), 'ECONNREFUSED');
});
