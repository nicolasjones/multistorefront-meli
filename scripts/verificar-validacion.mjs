// Decide el resultado del job `validacion` (el único check que el ruleset exige) a partir de los resultados de los jobs de
// Validate (`needs`). Antes era un `case` en el YAML que trataba igual `failure` y `cancelled`, y no sabía nada de los jobs
// no bloqueantes (MSF-901). Reglas:
//   - `success` y `skipped` son OK (lo salteado por el clasificador de cambios no es un fallo).
//   - `failure` falla SIEMPRE y se informa primero: es la causa real.
//   - `cancelled` falla, pero se informa aparte: con `fail-fast` apagado en la matriz `web` ya no es un efecto colateral de otro
//     fallo; es una cancelación real (corrida reemplazada o cancelada a mano) y esa corrida no puede darse por validada.
//   - `e2e-tienda` es no bloqueante mientras `E2E_TIENDA_BLOQUEA` no sea `true` (misma política que su `continue-on-error`, que
//     NO cubre la cancelación): su failure/cancelled se informa como aviso y no falla `validacion`.
import { pathToFileURL } from 'node:url';

export const JOBS_VALIDACION = ['changes', 'application', 'chequeos', 'web', 'e2e-tienda', 'infrastructure', 'database'];

export function evaluar({ needs, evento, repoOrigen, repo, ciPausado, e2eTiendaBloquea }) {
  if (evento === 'pull_request' && repoOrigen !== repo) {
    return { ok: false, mensajes: ['PR de un fork: no se valida en runners self-hosted; publicá la rama en este repo.'] };
  }
  if (ciPausado === 'true') {
    return { ok: false, mensajes: ['CI_PAUSED=true: no se valida ni se mergea mientras el CI esté pausado.'] };
  }
  const mensajes = [];
  const fallidos = [];
  const cancelados = [];
  const avisos = [];
  for (const job of JOBS_VALIDACION) {
    const resultado = needs?.[job]?.result;
    if (resultado === undefined) {
      fallidos.push(job);
      mensajes.push(`${job}=sin resultado (el job no figura en needs)`);
      continue;
    }
    mensajes.push(`${job}=${resultado}`);
    if (resultado === 'success' || resultado === 'skipped') continue;
    if (job === 'e2e-tienda' && e2eTiendaBloquea !== 'true') {
      avisos.push(`${job} terminó en ${resultado} y no es bloqueante (E2E_TIENDA_BLOQUEA != true).`);
    } else if (resultado === 'cancelled') cancelados.push(job);
    else fallidos.push(job);
  }
  mensajes.push(...avisos);
  if (fallidos.length > 0) {
    mensajes.push(`Fallaron: ${fallidos.join(', ')}.${cancelados.length ? ` Además cancelados: ${cancelados.join(', ')}.` : ''}`);
    return { ok: false, mensajes };
  }
  if (cancelados.length > 0) {
    mensajes.push(`Cancelados sin ninguna falla: ${cancelados.join(', ')}. La corrida se canceló (reemplazada o a mano) y no cuenta como validada: volvé a correrla.`);
    return { ok: false, mensajes };
  }
  mensajes.push('Validación OK (los jobs skipped cuentan como OK).');
  return { ok: true, mensajes };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const resultado = evaluar({
    needs: JSON.parse(process.env.NEEDS_JSON ?? '{}'),
    evento: process.env.EVENTO,
    repoOrigen: process.env.REPO_ORIGEN,
    repo: process.env.REPO,
    ciPausado: process.env.CI_PAUSED,
    e2eTiendaBloquea: process.env.E2E_TIENDA_BLOQUEA,
  });
  for (const mensaje of resultado.mensajes) console.log(mensaje);
  process.exit(resultado.ok ? 0 : 1);
}
