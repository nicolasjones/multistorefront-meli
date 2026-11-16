// Reparación del runner de GitHub cuando la autoactualización quedó a medias.
//
// El runner se autoactualiza en el sitio: renombra `bin` a `bin.<version>` y recién
// DESPUÉS deja el `bin` nuevo. Si el contenedor se reinicia en medio de ese swap (host
// saturado, OOM, `docker compose up`), `bin` queda ausente y el runner no arranca:
// `config.sh` muere con "./bin/Runner.Listener: No such file or directory" y el
// contenedor entra en crash-loop. En GitHub el runner queda registrado como
// OFFLINE+OCUPADO y el job que tenía tomado queda huérfano para siempre: el PR espera
// un CI que nunca termina (2026-11-03: 9 runs en cola, 2 h sin avanzar, MSF-223 y
// MSF-326 trabados).
//
// Este módulo es el que sabe restaurar el `bin`. Vive aparte del `entrypoint.mjs` para
// poder probarlo sin arrancar el runner (ver `restaurar-bin.test.mjs`).
import { existsSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';

const RESPALDO = /^bin\.\d+\.\d+\.\d+$/;

// La versión se compara por número y no por texto: «bin.2.10.0» es más nueva que «bin.2.9.0»
// (con el orden lexicográfico ganaba la vieja).
function versionDe(nombre) {
  return nombre.slice('bin.'.length).split('.').map(Number);
}

// Ordena respaldos del más nuevo al más viejo.
function porVersionDescendente(a, b) {
  const va = versionDe(a);
  const vb = versionDe(b);
  for (let i = 0; i < va.length; i += 1) {
    if (va[i] !== vb[i]) return vb[i] - va[i];
  }
  return 0;
}

// ¿El runner está listo para arrancar (tiene el listener)?
export function tieneBin(dir) {
  return existsSync(path.join(dir, 'bin', 'Runner.Listener'));
}

// Devuelve el nombre del respaldo usable (el más nuevo), o `null`.
export function respaldoUsable(dir) {
  const respaldos = readdirSync(dir)
    .filter((nombre) => RESPALDO.test(nombre))
    .sort(porVersionDescendente);
  for (const nombre of respaldos) {
    if (existsSync(path.join(dir, nombre, 'Runner.Listener'))) return nombre;
  }
  return null;
}

// Restaura `bin` desde el respaldo de la actualización interrumpida. Devuelve el nombre
// del respaldo usado, o `null` si no hubo nada que restaurar.
export function restaurarBin(dir) {
  if (tieneBin(dir)) return null;
  const respaldo = respaldoUsable(dir);
  if (!respaldo) return null;
  renameSync(path.join(dir, respaldo), path.join(dir, 'bin'));
  return respaldo;
}
