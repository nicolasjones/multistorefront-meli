#!/usr/bin/env node
// Guardián de la decisión MSF-852: la suite E2E corre en un job NOCTURNO sobre `dokploy` y no bloquea PRs.
// La implementación vive en `.github/workflows/e2e-nocturno.yml`; este guardián falla en CI si el contrato
// desaparece o cambia de forma que la decisión deje de cumplirse en silencio (el problema que abrió MSF-852).
//
// No parsea YAML completo (el repo no depende de un parser): verifica las marcas estructurales que definen el job.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = '.github/workflows/e2e-nocturno.yml';
const DOC = 'docs/e2e-app.md';

const marcas = [
  { nombre: 'schedule diario', patron: /cron:\s*['"]0 5 \* \* \*['"]/ },
  { nombre: 'disparo manual', patron: /^\s{2}workflow_dispatch:\s*$/m },
  { nombre: 'permisos de solo lectura', patron: /^\s{2}contents:\s*read\s*$/m },
  { nombre: 'checkout de dokploy en el cron', patron: /ref:\s*\$\{\{\s*github\.event_name == 'schedule' && 'dokploy'/ },
  { nombre: 'Playwright en serie', patron: /playwright test[\s\S]*--workers=1/ },
  { nombre: 'stack real de Supabase', patron: /^\s*supabase start\b/m },
  { nombre: 'migraciones aplicadas', patron: /^\s*supabase migration up\b/m },
];

export function verificarContrato(raiz = RAIZ) {
  const errores = [];
  let workflow;
  let docs;
  try {
    workflow = readFileSync(join(raiz, WORKFLOW), 'utf8');
  } catch {
    return { ok: false, errores: [`falta ${WORKFLOW}`] };
  }
  try {
    docs = readFileSync(join(raiz, DOC), 'utf8');
  } catch {
    return { ok: false, errores: [`falta ${DOC}`] };
  }

  if (/^\s{2}pull_request:/m.test(workflow)) errores.push('el job nocturno no debe dispararse en pull_request (no bloquea PRs)');
  for (const { nombre, patron } of marcas) {
    if (!patron.test(workflow)) errores.push(`el workflow no cumple «${nombre}»`);
  }
  if (!/^## E2E nocturno/m.test(docs)) errores.push(`falta la sección «## E2E nocturno» en ${DOC}`);
  if (!docs.includes(WORKFLOW)) errores.push(`${DOC} no menciona ${WORKFLOW}`);

  return { ok: errores.length === 0, errores };
}

const esCli = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esCli) {
  const resultado = verificarContrato();
  for (const error of resultado.errores) console.error(` - ${error}`);
  console[resultado.ok ? 'log' : 'error'](
    resultado.ok
      ? `E2E nocturno: contrato completo (${WORKFLOW} + ${DOC}).`
      : 'E2E nocturno: el contrato de la decisión MSF-852 está incompleto.',
  );
  process.exit(resultado.ok ? 0 : 1);
}
