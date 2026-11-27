// Pruebas de infra/vps/firewall-docker-user.sh (MSF-648) con binarios falsos en el PATH: nada toca el firewall real.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'vps', 'firewall-docker-user.sh');

async function entorno({ ufwActivo = false, sshd = 'port 22', ss = '', ipv6 = 'IPV6=yes', sleepFalso = false, confirmaEnSleep = false, insertFalla = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fw-'));
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const registro = path.join(dir, 'llamadas.log');
  const ufwDir = path.join(dir, 'etc-ufw');
  await mkdir(ufwDir);
  await writeFile(path.join(ufwDir, 'user.rules'), 'ORIGINAL\n');
  const defecto = path.join(dir, 'default-ufw');
  await writeFile(defecto, `${ipv6}\n`);
  const confirmacion = path.join(dir, 'confirmado');
  const falso = async (nombre, cuerpo = '') => {
    await writeFile(path.join(bin, nombre), `#!/bin/sh\necho "${nombre} $*" >> "${registro}"\n${cuerpo}\n`);
    await chmod(path.join(bin, nombre), 0o755);
  };
  await falso('iptables');
  await falso('ip6tables', 'exit 0');
  await falso('iptables-save', 'echo "*filter"; echo ":DOCKER-USER - [0:0]"; echo "-A DOCKER-USER -j RETURN"; echo "COMMIT"');
  // iptables-restore y ip6tables-restore registran lo que reciben por stdin (la cadena se reemplaza de forma atómica por ahí).
  await falso('ip6tables-save', 'echo "*filter"; echo ":DOCKER-USER - [0:0]"; echo "-A DOCKER-USER -j RETURN"; echo "COMMIT"');
  await falso('iptables-restore', `cat >> "${registro}"`);
  await falso('ip6tables-restore', `cat >> "${registro}"`);
  // ufw falso: `allow` escribe en el directorio de ufw (como el real), `status` informa el estado.
  await falso('ufw', `case "$1" in status) echo "Status: ${ufwActivo ? 'active' : 'inactive'}";; insert) ${insertFalla ? 'echo "ERROR: Invalid position" >&2; exit 1' : `echo "$*" >> "${ufwDir}/user.rules"`};; allow|default|deny) echo "$*" >> "${ufwDir}/user.rules";; esac`);
  // id, ip y sshd son de solo lectura: no se registran (el registro mide lo que el script CAMBIA).
  const silencioso = async (nombre, cuerpo) => { await writeFile(path.join(bin, nombre), `#!/bin/sh\n${cuerpo}\n`); await chmod(path.join(bin, nombre), 0o755); };
  await silencioso('id', 'echo 0');
  await silencioso('ip', 'echo "default via 10.0.0.1 dev ens3 proto dhcp"');
  await silencioso('sshd', sshd === null ? 'exit 1' : `echo "${sshd}"`);
  await silencioso('ss', ss === null ? 'exit 1' : `cat <<'FIN'\n${ss}\nFIN`);
  if (sleepFalso) {
    await writeFile(path.join(bin, 'sleep'), `#!/bin/sh\n/bin/sleep 1\n${confirmaEnSleep ? `touch "${confirmacion}"` : ''}\nexit 0\n`);
    await chmod(path.join(bin, 'sleep'), 0o755);
  }
  return { dir, bin, registro, ufwDir, defecto, confirmacion, respaldo: path.join(dir, 'respaldo') };
}

function correr(e, args) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${e.bin}:${process.env.PATH}`, ARCHIVO_CONFIRMACION: e.confirmacion, DIR_RESPALDO: e.respaldo, UFW_DIR: e.ufwDir, UFW_DEFAULT: e.defecto, HOME: e.dir },
  });
}

const llamadas = async (e) => { try { return (await readFile(e.registro, 'utf8')).trim().split('\n'); } catch { return []; } };
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('sin --aplicar solo imprime el plan y no ejecuta ningún binario', async () => {
  const e = await entorno();
  const r = correr(e, ['--interfaz-externa', 'eth0']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await llamadas(e), []);
  assert.match(r.stdout, /^# Plan \(no se ejecutó nada\)/);
  for (const puerto of ['22', '80', '443']) assert.match(r.stdout, new RegExp(`--ctorigdstport ${puerto} -j RETURN`));
  assert.match(r.stdout, /-A DOCKER-USER -i eth0 -j DROP/);
  assert.match(r.stdout, /ufw allow in on tailscale0/);
  for (const sensible of ['7634', '7635', '7636', '4301', '9300', '3000', '4305']) assert.doesNotMatch(r.stdout, new RegExp(`ctorigdstport ${sensible}\\b`));
  assert.ok(r.stdout.indexOf('ctorigdstport 443') < r.stdout.indexOf('-i eth0 -j DROP'));
  // Reemplazo atómico: un solo bloque *filter ... COMMIT con el flush DENTRO (nunca un `iptables -F` suelto).
  assert.match(r.stdout, /\*filter\n:DOCKER-USER - \[0:0\]\n-F DOCKER-USER\n[\s\S]*\nCOMMIT/);
  assert.doesNotMatch(r.stdout, /^iptables -F/m);
});

test('A3: las subredes de Docker llegan a los servicios del host (Postgres, Storage, SMTP) aunque `deny incoming`', async () => {
  const e = await entorno();
  const r = correr(e, ['--interfaz-externa', 'eth0']);
  for (const p of ['7634', '9300', '587', '8098']) assert.match(r.stdout, new RegExp(`ufw allow from 172\\.16\\.0\\.0/12 to any port ${p} proto tcp`));
  assert.ok(r.stdout.indexOf('ufw default deny incoming') < r.stdout.indexOf('ufw allow from 172.16.0.0/12'));
  const otra = correr(e, ['--interfaz-externa', 'eth0', '--subredes-docker', '10.250.0.0/16,172.30.0.0/16', '--puertos-host-desde-docker', '5432']);
  assert.match(otra.stdout, /ufw allow from 10\.250\.0\.0\/16 to any port 5432 proto tcp/);
  assert.match(otra.stdout, /ufw allow from 172\.30\.0\.0\/16 to any port 5432 proto tcp/);
  assert.doesNotMatch(otra.stdout, /port 7634/);
});

test('B6: varias interfaces externas: cada una con sus RETURN y su DROP', async () => {
  const e = await entorno();
  const r = correr(e, ['--interfaz-externa', 'eth0,eth1']);
  assert.match(r.stdout, /-A DOCKER-USER -i eth0 -j DROP/);
  assert.match(r.stdout, /-A DOCKER-USER -i eth1 -j DROP/);
  assert.match(r.stdout, /-i eth1 -p tcp -m conntrack --ctorigdstport 443 -j RETURN/);
  assert.match(correr(e, []).stdout, /Externas: ens3/);
});

test('validación de entradas: cada una inválida se rechaza con código 2 sin ejecutar nada (incluye nombres con guion inicial)', async () => {
  const e = await entorno();
  const invalidos = [
    ['--puertos-publicos', '80,443'],
    ['--puertos-publicos', '22;reboot'], ['--puertos-publicos', '22,,80'], ['--puertos-publicos', ',22'], ['--puertos-publicos', '22,'], ['--puertos-publicos', ''],
    ['--puertos-publicos', '22,70000'], ['--puertos-publicos', '22,0'],
    ['--puertos-host-desde-docker', '7634;ls'], ['--puertos-host-desde-docker', ''],
    ['--subredes-docker', '10.0.0.0/8;ls'], ['--subredes-docker', 'a.b'],
    ['--rollback-segundos', '29'], ['--rollback-segundos', '3601'], ['--rollback-segundos', 'x'], ['--rollback-segundos', '60;ls'],
    ['--interfaz-tailscale', 'ts0;rm -rf /'], ['--interfaz-tailscale', '-j'], ['--interfaz-externa', 'eth0 -j ACCEPT'], ['--interfaz-externa', '-j'], ['--interfaz-externa', 'eth0,-j'],
    ['--desconocido'],
  ];
  for (const args of invalidos) {
    const r = correr(e, ['--interfaz-externa', 'eth0', ...args]);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.deepEqual(await llamadas(e), []);
  for (const seg of ['30', '3600']) assert.equal(correr(e, ['--interfaz-externa', 'eth0', '--rollback-segundos', seg]).status, 0);
  assert.equal(correr(e, ['--interfaz-externa', 'eth0', '--puertos-publicos', '22,80,443,8443']).status, 0);
});

test('M3: el puerto real de sshd tiene que estar permitido; sin poder leerlo solo se avisa', async () => {
  const otroPuerto = await entorno({ sshd: 'port 2222' });
  const r = correr(otroPuerto, ['--interfaz-externa', 'eth0']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /el puerto 2222 y no está en --puertos-publicos/);
  assert.equal(correr(otroPuerto, ['--interfaz-externa', 'eth0', '--puertos-publicos', '2222,80,443']).status, 0);
  assert.equal(correr(otroPuerto, ['--interfaz-externa', 'eth0', '--puertos-publicos', '22,80,443,2222']).status, 0);
  // sshd con dos puertos: ambos deben estar
  const dos = await entorno({ sshd: 'port 22\nport 2200' });
  assert.equal(correr(dos, ['--interfaz-externa', 'eth0']).status, 2);
  assert.equal(correr(dos, ['--interfaz-externa', 'eth0', '--puertos-publicos', '22,2200,80']).status, 0);
  const ilegible = await entorno({ sshd: null });
  const a = correr(ilegible, ['--interfaz-externa', 'eth0']);
  assert.equal(a.status, 0);
  assert.match(a.stderr, /no pude leer los puertos de sshd/);
  assert.deepEqual(await llamadas(otroPuerto), []);
});

test('M5: sin IPV6=yes en ufw se aborta; con IPV6=yes pasa', async () => {
  const e = await entorno({ ipv6: 'IPV6=no' });
  const r = correr(e, ['--interfaz-externa', 'eth0']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ufw no filtra IPv6/);
  const ok = await entorno({ ipv6: '# comentario\nIPV6=yes' });
  assert.equal(correr(ok, ['--interfaz-externa', 'eth0']).status, 0);
});

test('--aplicar: respalda primero, permite 22 antes de activar ufw y reemplaza DOCKER-USER por stdin de restore (v4 y v6)', async () => {
  const e = await entorno();
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  assert.equal(r.status, 0, r.stderr);
  const l = await llamadas(e);
  const indice = (texto) => l.findIndex((x) => x.includes(texto));
  assert.ok(indice('iptables-save -t filter') === 0, 'el respaldo es lo primero');
  assert.ok(indice('ufw allow 22/tcp') !== -1 && indice('ufw allow 22/tcp') < indice('ufw --force enable'));
  assert.ok(indice('ufw allow from 172.16.0.0/12 to any port 7634') < indice('ufw --force enable'), 'las subredes de Docker se permiten antes de activar');
  assert.ok(l.includes('iptables-restore --noflush') && l.includes('ip6tables-restore --noflush'));
  assert.ok(l.filter((x) => x === '-F DOCKER-USER').length === 2, 'el flush va dentro del restore, para v4 y v6');
  assert.ok(!l.some((x) => x.startsWith('iptables -F')), 'nunca se vacía la cadena por fuera del restore atómico');
  assert.match(r.stdout, /touch .*confirmado/);
  const archivos = await readdir(e.respaldo);
  assert.ok(archivos.some((f) => f.startsWith('rollback-') && f.endsWith('.sh')) && archivos.some((f) => f.startsWith('ufw-')));
});

test('M2: el rollback restaura DOCKER-USER, /etc/ufw y el estado de ufw, y se ejecuta DESACOPLADO si no se confirma', async () => {
  const e = await entorno({ sleepFalso: true });
  const antes = Date.now();
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Date.now() - antes < 5000, 'el comando no queda bloqueado esperando al rollback (setsid + nohup, sin heredar stdout)');
  assert.match(r.stdout, /Rollback programado en 30s/);
  await espera(2500);
  const l = await llamadas(e);
  assert.ok(l.filter((x) => x === 'iptables-restore --noflush').length >= 2, `el rollback vuelve a llamar a restore --noflush: ${l.join(' | ')}`);
  assert.equal(await readFile(path.join(e.ufwDir, 'user.rules'), 'utf8'), 'ORIGINAL\n', 'lo que ufw escribió en /etc/ufw se revierte');
  assert.ok(l.includes('ufw --force disable'), 'ufw estaba inactivo: el rollback lo apaga');
});

test('el rollback NO se ejecuta si se confirma, y si ufw ya estaba activo hace reload en vez de disable', async () => {
  const confirmado = await entorno({ sleepFalso: true, confirmaEnSleep: true });
  correr(confirmado, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  await espera(2500);
  assert.equal((await llamadas(confirmado)).filter((x) => x === 'iptables-restore --noflush').length, 1, 'solo la aplicación, ningún rollback');
  assert.match(await readFile(path.join(confirmado.ufwDir, 'user.rules'), 'utf8'), /allow 22\/tcp/);
  const activo = await entorno({ sleepFalso: true, ufwActivo: true });
  correr(activo, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  await espera(2500);
  const l = await llamadas(activo);
  assert.ok(l.includes('ufw --force reload') && !l.includes('ufw --force disable'));
});

test('A3: un --chequeo que falla después de aplicar revierte AL INSTANTE y sale 1; uno que pasa no revierte', async () => {
  const falla = await entorno();
  const r = correr(falla, ['--aplicar', '--interfaz-externa', 'eth0', '--chequeo', 'true', '--chequeo', 'exit 1']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FALLÓ el chequeo posterior \(o superó 20s\): exit 1/);
  assert.match(r.stderr, /Rollback del firewall ejecutado/);
  assert.equal(await readFile(path.join(falla.ufwDir, 'user.rules'), 'utf8'), 'ORIGINAL\n');
  const pasa = await entorno({ sleepFalso: true, confirmaEnSleep: true });
  const ok = correr(pasa, ['--aplicar', '--interfaz-externa', 'eth0', '--chequeo', 'true', '--rollback-segundos', '30']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(await readFile(path.join(pasa.ufwDir, 'user.rules'), 'utf8'), /allow 22\/tcp/);
});

test('--aplicar sin root se rechaza', async () => {
  const e = await entorno();
  await writeFile(path.join(e.bin, 'id'), '#!/bin/sh\necho 1000\n');
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /necesita root/);
  assert.deepEqual(await llamadas(e), []);
});

test('--sin-rollback (unidad systemd de arranque): aplica sin programar rollback ni pedir confirmación; el plan no cambia', async () => {
  const e = await entorno();
  const r = correr(e, ['--aplicar', '--sin-rollback', '--interfaz-externa', 'eth0']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Reglas aplicadas \(sin rollback\)/);
  assert.doesNotMatch(r.stdout, /Rollback programado|touch /);
  assert.ok((await llamadas(e)).includes('-A DOCKER-USER -i eth0 -j DROP'));
  assert.match(correr(await entorno(), ['--sin-rollback', '--interfaz-externa', 'eth0']).stdout, /^# Plan \(no se ejecutó nada\)/);
});

// ---- Revisión C+S del #1238 ----

test('A-1: las redes de jobs se aíslan: deny en ufw ANTES de los allow, y DROP en DOCKER-USER hacia tailnet, metadatos y red interna', async () => {
  const e = await entorno();
  const r = correr(e, ['--interfaz-externa', 'eth0']);
  const plan = r.stdout;
  // ufw: el deny de la red de jobs de PR es lo primero y precede a cualquier allow desde las subredes de los servicios.
  assert.match(plan, /ufw insert 1 deny from 172\.29\.250\.0\/24/);
  assert.ok(plan.indexOf('ufw insert 1 deny from 172.29.250.0/24') < plan.indexOf('ufw allow from 172.16.0.0/12'), 'el deny de jobs va antes del allow amplio');
  // deploy: solo los puertos de base que migra, y luego deny del resto.
  assert.match(plan, /ufw insert 2 allow from 172\.29\.251\.0\/24 to any port 7635 proto tcp/);
  assert.match(plan, /ufw insert 3 allow from 172\.29\.251\.0\/24 to any port 7636 proto tcp/);
  assert.match(plan, /ufw insert 4 deny from 172\.29\.251\.0\/24/);
  assert.doesNotMatch(plan, /ufw insert \d+ allow from 172\.29\.250\.0\/24/, 'la red de PR no recibe ningún puerto del host');
  // DOCKER-USER: cada red de jobs descarta tailscale0, metadatos, tailnet y RFC1918; y solo Internet queda.
  for (const j of ['172.29.250.0/24', '172.29.251.0/24']) {
    for (const regla of [`-s ${j} -o tailscale0 -j DROP`, `-s ${j} -d 169.254.0.0/16 -j DROP`, `-s ${j} -d 100.64.0.0/10 -j DROP`, `-s ${j} -d 10.0.0.0/8 -j DROP`, `-s ${j} -d 172.16.0.0/12 -j DROP`, `-s ${j} -d 192.168.0.0/16 -j DROP`]) {
      assert.ok(plan.includes(`-A DOCKER-USER ${regla}`), regla);
    }
  }
  // Las reglas de jobs van DESPUÉS del RETURN de conexiones establecidas y ANTES de cualquier RETURN de interfaz (lo, tailscale, externas).
  const iEstablecidas = plan.indexOf('RELATED,ESTABLISHED');
  const iJobs = plan.indexOf('-s 172.29.250.0/24 -o tailscale0');
  assert.ok(iEstablecidas < iJobs && iJobs < plan.indexOf('-A DOCKER-USER -i lo -j RETURN'));
  // La red de PR no tiene excepción hacia la tailnet; la de deploy solo las que se pidan.
  assert.doesNotMatch(plan, /-s 172\.29\.250\.0\/24 -d 100\.\d+\.\d+\.\d+ -o tailscale0 -j RETURN/);
  const con = correr(e, ['--interfaz-externa', 'eth0', '--destinos-tailnet-deploy', '100.64.0.9,100.64.0.10']).stdout;
  assert.ok(con.includes('-A DOCKER-USER -s 172.29.251.0/24 -d 100.64.0.9 -o tailscale0 -j RETURN'));
  assert.ok(con.indexOf('-d 100.64.0.9 -o tailscale0 -j RETURN') < con.indexOf('-s 172.29.251.0/24 -o tailscale0 -j DROP'), 'la excepción precede al DROP');
  assert.ok(!con.includes('-s 172.29.250.0/24 -d 100.64.0.9'));
});

test('A-1: parámetros de las redes de jobs: se respetan, se validan y no pueden coincidir', async () => {
  const e = await entorno();
  const otro = correr(e, ['--interfaz-externa', 'eth0', '--subred-jobs-pr', '10.77.0.0/24', '--subred-jobs-deploy', '10.78.0.0/24', '--puertos-db-deploy', '5432']).stdout;
  assert.match(otro, /ufw insert 1 deny from 10\.77\.0\.0\/24/);
  assert.match(otro, /ufw insert 2 allow from 10\.78\.0\.0\/24 to any port 5432 proto tcp/);
  assert.doesNotMatch(otro, /172\.29\.25/);
  for (const malo of [['--subred-jobs-pr', '10.0.0.0/24;ls'], ['--subred-jobs-pr', 'x'], ['--subred-jobs-pr', '10.0.0.0'], ['--subred-jobs-deploy', '/24'], ['--subred-jobs-deploy', '10.0.0.0/'],
    ['--subred-jobs-pr', '172.29.251.0/24'], ['--puertos-db-deploy', '7635;x'], ['--puertos-db-deploy', ''], ['--destinos-tailnet-deploy', '100.64.0.9;x'], ['--destinos-tailnet-deploy', 'abc']]) {
    assert.equal(correr(e, ['--interfaz-externa', 'eth0', ...malo]).status, 2, malo.join(' '));
  }
  assert.deepEqual(await llamadas(e), []);
});

test('A-1: las reglas de jobs son IPv4: el DOCKER-USER de IPv6 no las lleva', async () => {
  const e = await entorno();
  correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  const registro = await readFile(e.registro, 'utf8');
  const bloques = registro.split('*filter').slice(1);
  assert.equal(bloques.length, 2, 'un bloque para v4 y otro para v6');
  assert.ok(bloques[0].includes('-s 172.29.250.0/24') && !bloques[1].includes('172.29.25'));
});

test('A-1: sin posición válida en ufw (lista vacía) `ufw insert` cae a agregar la regla al final', async () => {
  const e = await entorno({ insertFalla: true });
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  assert.equal(r.status, 0, r.stderr);
  const reglas = await readFile(path.join(e.ufwDir, 'user.rules'), 'utf8');
  assert.match(reglas, /deny from 172\.29\.250\.0\/24/);
  assert.match(reglas, /allow from 172\.29\.251\.0\/24 to any port 7635 proto tcp/);
  assert.ok(reglas.indexOf('deny from 172.29.250.0/24') < reglas.indexOf('allow from 172.16.0.0/12 to any port 7634'), 'el orden se conserva');
});

test('M-2: los puertos de sshd salen de sshd -T Y de lo que de verdad escucha (ssh.socket); todos deben estar permitidos', async () => {
  const escucha = (puerto) => `LISTEN 0 128 0.0.0.0:${puerto} 0.0.0.0:* users:(("sshd",pid=10,fd=3))\nLISTEN 0 4096 0.0.0.0:7634 0.0.0.0:* users:(("docker-proxy",pid=11,fd=4))`;
  // sshd -T dice 22 pero el socket escucha en 2222 (ssh.socket): se exige 2222.
  const socket = await entorno({ sshd: 'port 22', ss: escucha(2222) });
  const r = correr(socket, ['--interfaz-externa', 'eth0']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /puerto 2222/);
  assert.equal(correr(socket, ['--interfaz-externa', 'eth0', '--puertos-publicos', '22,2222,80,443']).status, 0);
  // Al revés: sshd -T dice 2200 y el socket escucha en 22.
  const alReves = await entorno({ sshd: 'port 2200', ss: escucha(22) });
  assert.equal(correr(alReves, ['--interfaz-externa', 'eth0']).status, 2);
  assert.equal(correr(alReves, ['--interfaz-externa', 'eth0', '--puertos-publicos', '22,2200,80']).status, 0);
  // Un puerto que no es de sshd (docker-proxy 7634) no se exige público.
  const solo22 = await entorno({ sshd: 'port 22', ss: escucha(22) });
  assert.equal(correr(solo22, ['--interfaz-externa', 'eth0']).status, 0);
  // Dirección IPv6 `[::]:22` también se interpreta.
  const v6 = await entorno({ sshd: null, ss: 'LISTEN 0 128 [::]:2201 [::]:* users:(("sshd",pid=1,fd=4))' });
  assert.equal(correr(v6, ['--interfaz-externa', 'eth0']).status, 2);
  // sin ninguna fuente: aviso
  const nada = await entorno({ sshd: null, ss: null });
  const a = correr(nada, ['--interfaz-externa', 'eth0']);
  assert.equal(a.status, 0);
  assert.match(a.stderr, /no pude leer los puertos de sshd/);
});

test('M-3: el rollback respalda y restaura también DOCKER-USER de IPv6', async () => {
  const e = await entorno({ sleepFalso: true });
  correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--rollback-segundos', '30']);
  await espera(2500);
  const l = await llamadas(e);
  assert.ok(l.includes('ip6tables-restore --noflush'));
  assert.equal(l.filter((x) => x === 'ip6tables-restore --noflush').length, 2, 'aplicación + rollback v6');
  assert.ok((await readdir(e.respaldo)).some((f) => f.startsWith('ip6tables-') && f.endsWith('.rules')), 'respaldo de ip6tables');
  assert.ok(l.some((x) => x.startsWith('ip6tables-save')));
});

test('M-3: un --chequeo con tope: si cuelga más que CHEQUEO_TIMEOUT se trata como fallo y revierte', async () => {
  const e = await entorno();
  const antes = Date.now();
  const r = spawnSync('bash', [script, '--aplicar', '--interfaz-externa', 'eth0', '--chequeo', 'sleep 30'], {
    encoding: 'utf8', env: { PATH: `${e.bin}:${process.env.PATH}`, ARCHIVO_CONFIRMACION: e.confirmacion, DIR_RESPALDO: e.respaldo, UFW_DIR: e.ufwDir, UFW_DEFAULT: e.defecto, HOME: e.dir, CHEQUEO_TIMEOUT: '1' },
  });
  assert.equal(r.status, 1);
  assert.ok(Date.now() - antes < 8000, 'el chequeo no espera los 30 s');
  assert.match(r.stderr, /superó 1s/);
  assert.equal(await readFile(path.join(e.ufwDir, 'user.rules'), 'utf8'), 'ORIGINAL\n');
  assert.equal(correr(e, ['--interfaz-externa', 'eth0', '--aplicar']).status !== undefined, true);
  const mal = spawnSync('bash', [script, '--interfaz-externa', 'eth0'], { encoding: 'utf8', env: { PATH: `${e.bin}:${process.env.PATH}`, UFW_DIR: e.ufwDir, UFW_DEFAULT: e.defecto, CHEQUEO_TIMEOUT: '1;ls', HOME: e.dir } });
  assert.equal(mal.status, 2);
});

test('M-3: tras un rollback inmediato el temporizador viejo queda cancelado y no revierte de nuevo', async () => {
  const e = await entorno({ sleepFalso: true });
  const r = correr(e, ['--aplicar', '--interfaz-externa', 'eth0', '--chequeo', 'exit 1', '--rollback-segundos', '30']);
  assert.equal(r.status, 1);
  await espera(2500);
  const l = await llamadas(e);
  // aplicación (1) + rollback inmediato (1): el temporizador, al despertar, ve el archivo .cancelado y no restaura una tercera vez.
  assert.equal(l.filter((x) => x === 'iptables-restore --noflush').length, 2, `restores: ${l.filter((x) => x.includes('restore')).join(' | ')}`);
  assert.ok((await readdir(e.respaldo)).some((f) => f.endsWith('.cancelado')));
});

test('B-5: el encabezado de uso lista los puertos por defecto reales y advierte del eval de --chequeo', async () => {
  const texto = await readFile(script, 'utf8');
  const porDefecto = texto.match(/^puertos_docker="([^"]+)"/m)[1];
  const uso = texto.match(/\[--puertos-host-desde-docker ([^\]]+)\]/)[1];
  assert.equal(uso, porDefecto);
  assert.match(texto, /es un `eval` escrito por el OPERADOR/);
  assert.match(texto, /ip -o -6 route show default/);
  assert.match(texto, /NO retira reglas `ufw allow\/deny` viejas/);
});
