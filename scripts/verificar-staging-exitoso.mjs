import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumentValue, requireEnvironment, redactError } from './operaciones.mjs';

// Gate stg→prd (bug gate-migraciones-stg-prd): production no debe poder aplicarse sobre un cambio que staging nunca validó.
// Se verifica contra la API de runs de GitHub en vez de requerir `needs: staging` (imposible entre disparadores distintos: push
// vs workflow_dispatch) o required reviewers (feature de plan pago en repos privados — ver research.md §6, Revisión 2).
//
// MSF-674: antes exigía un run de staging con conclusion=success PARA EL MISMO head_sha. Pero staging dispara por `paths`: un
// commit a main que no toca esos archivos nunca genera run de staging, y `promover-todo-a-produccion` fallaba casi siempre. Lo que
// corresponde validar es que NINGÚN cambio relevante para el mecanismo quedó sin pasar por staging. Regla vigente:
//   1. Hay un run de staging exitoso para el mismo SHA → autorizado (igual que antes).
//   2. Si no, el run exitoso más reciente cuyo SHA es ANCESTRO del que se promueve; si entre ese SHA y el que se promueve no cambió
//      ningún archivo de `on.push.paths` del workflow (se lee del propio archivo, sin duplicarlos) → autorizado: staging ya validó
//      el último estado relevante.
//   3. Cualquier otro caso (sin run exitoso ancestro, cambios relevantes posteriores, comparación truncada) → rechazado.
// Orden de la promoción (docs/deployment.md): STG va un paso adelante de PRD; se sincroniza STG con dokploy ANTES de promover.

// Glob mínimo de GitHub Actions: `**` cruza directorios, `*` no, el resto literal.
export function globARegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Lista `on.push.paths` de un workflow (YAML simple, como los de este repo).
export function pathsDeWorkflow(texto) {
  const lineas = texto.split('\n');
  const inicio = lineas.findIndex((l) => /^ {2}push:\s*$/.test(l));
  if (inicio === -1) return [];
  const paths = [];
  let dentro = false;
  for (const linea of lineas.slice(inicio + 1)) {
    if (/^ {2}\S/.test(linea) || /^\S/.test(linea)) break;
    if (/^ {4}paths:\s*$/.test(linea)) { dentro = true; continue; }
    if (dentro) {
      const m = linea.match(/^ {6}- "?([^"\n]+?)"?\s*$/);
      if (m) paths.push(m[1]);
      else if (linea.trim() && !linea.trim().startsWith('#')) break;
    }
  }
  return paths;
}

export function archivosRelevantes(archivos, paths) {
  const regex = paths.map(globARegex);
  return archivos.filter((archivo) => regex.some((r) => r.test(archivo)));
}

export async function verificar({ workflow, headSha, branch = 'main', token, repository, apiUrl, pathsWorkflow, fetchFn = fetch }) {
  const cabeceras = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const api = async (url, descripcion, { tolerar404 = false } = {}) => {
    const response = await fetchFn(url, { headers: cabeceras });
    if (tolerar404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`La API de GitHub respondió ${response.status} al ${descripcion}.`);
    return response.json();
  };

  const runsUrl = `${apiUrl}/repos/${repository}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&event=push&status=success&per_page=100`;
  const body = await api(runsUrl, `listar runs de ${workflow}`);
  const runs = (Array.isArray(body.workflow_runs) ? body.workflow_runs : []).filter((run) => run.conclusion === 'success');

  if (runs.some((run) => run.head_sha === headSha)) {
    return { autorizado: true, motivo: `staging corrió exitosamente para ${headSha} en ${workflow}.` };
  }

  if (!pathsWorkflow || pathsWorkflow.length === 0) {
    return { autorizado: false, motivo: `staging nunca corrió exitosamente para el commit ${headSha} en ${workflow}.` };
  }

  // Más reciente primero (la API ya devuelve en ese orden, pero no se depende de eso).
  const candidatos = [...runs].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  for (const run of candidatos) {
    const comparacion = await api(`${apiUrl}/repos/${repository}/compare/${run.head_sha}...${headSha}?per_page=100`, `comparar ${run.head_sha} con ${headSha}`, { tolerar404: true });
    // 404: el SHA del run ya no existe en el repo (rama reescrita): no sirve de base.
    if (!comparacion) continue;
    // `ahead` / `identical`: el run es ancestro del commit a promover. `diverged` / `behind`: no sirve como base.
    if (comparacion.status !== 'ahead' && comparacion.status !== 'identical') continue;
    const archivos = Array.isArray(comparacion.files) ? comparacion.files.map((f) => f.filename) : [];
    const truncada = (comparacion.total_commits ?? 0) > (comparacion.commits?.length ?? 0) || archivos.length >= 300;
    if (truncada) {
      return { autorizado: false, motivo: `la comparación entre el último staging exitoso (${run.head_sha}) y ${headSha} es demasiado grande para verificarla; corré staging de nuevo.` };
    }
    const relevantes = archivosRelevantes(archivos, pathsWorkflow);
    if (relevantes.length > 0) {
      return { autorizado: false, motivo: `hay cambios de ${workflow} posteriores al último staging exitoso (${run.head_sha}) que staging no validó: ${relevantes.slice(0, 5).join(', ')}.` };
    }
    return { autorizado: true, motivo: `staging validó el último estado relevante de ${workflow} (run en ${run.head_sha}); ningún commit posterior hasta ${headSha} toca sus archivos.` };
  }
  return { autorizado: false, motivo: `no hay ningún run exitoso de staging de ${workflow} que sea ancestro de ${headSha}.` };
}

async function main() {
  const args = process.argv.slice(2);
  const workflow = argumentValue(args, '--workflow');
  if (!workflow) throw new Error('Uso: pnpm verificar:staging-exitoso -- --workflow <archivo.yml> --head-sha <sha> [--branch main]');

  const headSha = argumentValue(args, '--head-sha');
  if (!headSha) throw new Error('Falta --head-sha.');

  const branch = argumentValue(args, '--branch', 'main');
  const token = requireEnvironment('GITHUB_TOKEN');
  const repository = requireEnvironment('GITHUB_REPOSITORY');
  const apiUrl = process.env.GITHUB_API_URL?.trim() || 'https://api.github.com';

  try {
    let pathsWorkflow = [];
    try {
      pathsWorkflow = pathsDeWorkflow(await readFile(path.join(argumentValue(args, '--workflows-dir', '.github/workflows'), workflow), 'utf8'));
    } catch {
      // Sin el archivo del workflow no se puede aflojar la regla: queda la exigencia estricta del mismo SHA.
    }
    const { autorizado, motivo } = await verificar({ workflow, headSha, branch, token, repository, apiUrl, pathsWorkflow });
    if (!autorizado) {
      console.error(`::error::${motivo} — no se puede promover a producción. Sincronizá staging con dokploy (push a main) y esperá a que termine antes de disparar production.`);
      process.exit(1);
    }
    console.log(`${motivo} Promoción a producción autorizada.`);
  } catch (error) {
    throw new Error(redactError(error));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
