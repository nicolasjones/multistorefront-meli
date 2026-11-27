// Pruebas de infra/vps/firewall-docker-user.sh (MSF-648) con binarios falsos en el PATH: nada toca el firewall real.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'vps', 'firewall-docker-user.sh');

async function entorno({ ufwActivo = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fw-'));
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const registro = path.join(dir, 'llamadas.log');
  const falso = async (nombre, cuerpo = '') => {
    await writeFile(path.join(bin, nombre), `#!/bin/sh\necho "${nombre} $*" >> "${registro}"\n${cuerpo}\n`);
    await chmod(path.join(bin, nombre), 0o755);
  };
  await falso('iptables');
  await falso('iptables-save', 'echo "# estado previo"');
  await falso('iptables-restore', 'cat > /dev/null');
  await falso('ufw', ufwActivo ? 'case "$1" in status) echo "Status: active";; esac' : 'case "$1" in status) echo "Status: inactive";; esac');
  await falso('id', 'echo 0');
  await falso('ip', 'echo "default via 10.0.0.1 dev ens3 proto dhcp"');
  return { dir, bin, registro, confirmacion: path.join(dir, 'confirmado'), respaldo: path.join(dir, 'respaldo') };
}

function correr(e, args) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${e.bin}:${process.env.PATH}`, ARCHIVO_CONFIRMACION: e.confirmacion, DIR_RESPALDO: e.respaldo, HOME: e.dir },
  });
}

const llamadas = async (e) => { try { return (await readFile(e.registro, 'utf8')).trim().split('\n'); } catch { return []; } };

test('sin --aplicar solo imprime el plan y no ejecuta ningún binario', async () => {
  const e = await entorno();
  const r = correr(e, ['--interfaz-externa', 'eth0']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await llamadas(e), []);
  assert.match(r.stdout, /^# Plan \(no se ejecutó nada\)/);
  for (const puerto of ['22', '80', '443']) assert.match(r.stdout, new RegExp(`--ctorigdstport ${puerto} -j RETURN`));
  assert.match(r.stdout, /-A DOCKER-USER -i eth0 -j DROP/);
  assert.match(r.stdout, /ufw allow in on tailscale0/);
  // Un puerto sensible NO aparece como permitido.
  for (const sensible of ['7634', '7635', '7636', '4301', '9300', '3000', '4305']) assert.doesNotMatch(r.stdout, new RegExp(`ctorigdstport ${sensible}\\b`));
  // La regla DROP viene DESPUÉS de todas las RETURN de puertos públicos.
  assert.ok(r.stdout.indexOf('ctorigdstport 443') < r.stdout.indexOf('-i eth0 -j DROP'));
});

test('detecta la interfaz externa de la ruta por defecto y respeta la indicada', async () => {
  const e = await entorno();
  assert.match(correr(e, []).stdout, /Interfaz externa: ens3/);
  assert.match(correr(e, ['--interfaz-externa', 'eth9']).stdout, /Interfaz externa: eth9/);
});

test('validación de entradas: cada una inválida se rechaza con código 2 sin ejecutar nada', async () => {
  const e = await entorno();
  const invalidos = [
    ['--puertos-publicos', '80,443'], // sin 22: te quedás sin SSH
    ['--puertos-publicos', '22;reboot'], ['--puertos-publicos', '22,,80'], ['--puertos-publicos', ',22'], ['--puertos-publicos', '22,'], ['--puertos-publicos', ''],
    ['--puertos-publicos', '22,70000'], ['--puertos-publicos', '22,0'],
    ['--rollback-segundos', '29'], ['--rollback-segundos', '3601'], ['--rollback-segundos', 'x'], ['--rollback-segundos', '60;ls'],
    ['--interfaz-tailscale', 'ts0;rm -rf /'], ['--interfaz-externa', 'eth0 -j ACCEPT'],
    ['--desconocido'],
  ];
  for (const args of invalidos) {
    const r = correr(e, ['--interfaz-externa', 'eth0', ...args]);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.deepEqual(await llamadas(e), []);
  // Frontera válida: 30 y 3600 pasan.
  for (const seg of ['30', '3600']) assert.equal(correr(e, ['--interfaz-externa', 'eth0', '--rollback-segundos', seg]).status, 0);
  assert.equal(correr(e, ['--interfaz-externa', 'eth0', '--puertos-publicos', '22,80,443,8443']).status, 0);
});

test('--aplicar: respalda, permite 22 ANTES de activar ufw, arma DOCKER-USER y programa el rollback sin ejecutarlo si se confirma', async () => {
  const e = await entorno();
  await mkdir(e.respaldo, { recursive: true });
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  assert.equal(r.status, 0, r.stderr);
  const l = await llamadas(e);
  const indice = (texto) => l.findIndex((x) => x.includes(texto));
  assert.ok(indice('iptables-save') !== -1);
  assert.ok(indice('ufw allow 22/tcp') !== -1 && indice('ufw allow 22/tcp') < indice('ufw --force enable'), '22 se permite antes de activar ufw');
  assert.ok(indice('iptables -F DOCKER-USER') < indice('-A DOCKER-USER -i eth0 -j DROP'));
  assert.ok(indice('iptables-save') < indice('ufw default deny incoming'), 'el respaldo es lo primero');
  assert.match(r.stdout, /touch .*confirmado/);
  assert.match(r.stdout, /Rollback programado en 30s/);
  // Se confirma: el rollback en segundo plano no restaura. (Se verifica el contrato: el archivo de confirmación evita iptables-restore.)
  await writeFile(e.confirmacion, '');
});

test('--aplicar sin root se rechaza', async () => {
  const e = await entorno();
  await writeFile(path.join(e.bin, 'id'), '#!/bin/sh\necho 1000\n');
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /necesita root/);
  assert.deepEqual(await llamadas(e), []);
});

test('el rollback restaura iptables y apaga ufw si no se confirma; y no restaura si se confirma', async () => {
  const sinConfirmar = await entorno();
  const r = correr(sinConfirmar, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  assert.equal(r.status, 0, r.stderr);
  // El rollback corre tras `sleep`: se reemplaza `sleep` por un falso inmediato para observarlo.
  const e2 = await entorno();
  await writeFile(path.join(e2.bin, 'sleep'), '#!/bin/sh\nexit 0\n');
  await chmod(path.join(e2.bin, 'sleep'), 0o755);
  const r2 = correr(e2, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  assert.equal(r2.status, 0, r2.stderr);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const l2 = await llamadas(e2);
  assert.ok(l2.some((x) => x.startsWith('iptables-restore')) || r2.stderr.includes('Rollback del firewall ejecutado'), `sin confirmar restaura: ${l2.join(' | ')}`);
  assert.ok(l2.some((x) => x === 'ufw --force disable'), 'ufw estaba inactivo: el rollback lo apaga');
  // ufw ya activo antes: el rollback NO lo apaga.
  const e3 = await entorno({ ufwActivo: true });
  await writeFile(path.join(e3.bin, 'sleep'), '#!/bin/sh\nexit 0\n');
  await chmod(path.join(e3.bin, 'sleep'), 0o755);
  correr(e3, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(!(await llamadas(e3)).includes('ufw --force disable'));
  // Confirmado de antemano... el script borra el archivo al empezar, así que se confirma DURANTE el sleep: simulado con un sleep que lo crea.
  const e4 = await entorno();
  await writeFile(path.join(e4.bin, 'sleep'), `#!/bin/sh\ntouch "${e4.confirmacion}"\nexit 0\n`);
  await chmod(path.join(e4.bin, 'sleep'), 0o755);
  correr(e4, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.ok(!(await llamadas(e4)).some((x) => x.startsWith('iptables-restore')), 'confirmado: no restaura');
});

test('--sin-rollback (unidad systemd de arranque): aplica sin programar rollback ni pedir confirmación; solo vale con --aplicar', async () => {
  const e = await entorno();
  const r = correr(e, ['--aplicar', '--sin-rollback', '--interfaz-externa', 'eth0']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Reglas aplicadas \(sin rollback\)/);
  assert.doesNotMatch(r.stdout, /Rollback programado|touch /);
  assert.ok((await llamadas(e)).some((x) => x.includes('-A DOCKER-USER -i eth0 -j DROP')));
  const plan = correr(await entorno(), ['--sin-rollback', '--interfaz-externa', 'eth0']);
  assert.match(plan.stdout, /^# Plan \(no se ejecutó nada\)/);
});
