#!/usr/bin/env node
// Guardián de la decisión MSF-852: la suite E2E corre en un job NOCTURNO sobre `dokploy` y no bloquea PRs.
// La implementación vive en `.github/workflows/e2e-nocturno.yml`; este guardián falla en CI si el contrato
// desaparece o cambia de forma que la decisión deje de cumplirse en silencio (el problema que abrió MSF-852).
//
// No parsea YAML completo (el repo no depende de un parser): verifica las marcas estructurales que definen el job.
// Las prohibiciones (disparos de PR, `continue-on-error`) se leen tolerando cualquier forma YAML válida: una guarda
// que sólo reconoce una indentación da verde falso justo cuando la decisión se rompe.

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
  // Kill switch del job: sin esta condición el job queda apagado (o apagado siempre) sin que nadie lo note.
  { nombre: 'kill switch del job', patron: /^\s*if:\s*\$\{\{\s*vars\.CI_PAUSED != 'true' && vars\.CI_E2E_NOCTURNO != 'false'\s*\}\}\s*$/m },
  // Guarda contra omisiones masivas: sin ella el run queda verde con toda la suite omitida.
  { nombre: 'guarda contra omisiones masivas', patron: /omitidos\.length\s*\*\s*2\s*>\s*filas\.length/ },
];

// `pull_request`/`pull_request_target` como disparo, en bloque (`  pull_request:`, con cualquier indentación),
// en lista (`- pull_request`), en flujo (`on: [push, pull_request]`, `on: {pull_request: …}`) o escalar (`on: pull_request`).
// Ignora los comentarios de línea completa para no fallar por una mención en prosa.
function disparaEnPR(workflow) {
  const lineas = workflow.split('\n').filter((linea) => !/^\s*#/.test(linea));
  const eventoPR = /\bpull_request(?:_target)?\b/;
  let enBloqueOn = false;
  let indentOn = 0;
  for (const linea of lineas) {
    const cabecera = linea.match(/^(\s*)['"]?on['"]?\s*:\s*(.*)$/);
    if (cabecera) {
      const valor = cabecera[2].replace(/\s+#.*$/, '').trim();
      if (valor) {
        if (eventoPR.test(valor)) return true;
        continue;
      }
      enBloqueOn = true;
      indentOn = cabecera[1].length;
      continue;
    }
    if (!enBloqueOn || !linea.trim()) continue;
    const indent = linea.match(/^\s*/)[0].length;
    if (indent <= indentOn) {
      enBloqueOn = false;
      continue;
    }
    const item = linea.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '');
    if (/^pull_request(?:_target)?\s*(?::|$)/.test(item)) return true;
  }
  return false;
}

// `continue-on-error` en el job o en un paso (salvo `false` literal) anula el `process.exitCode = 1` del
// resumen: el run queda verde con toda la suite omitida, que es exactamente la pudredumbre de MSF-852.
function usaContinueOnError(workflow) {
  return workflow
    .split('\n')
    .filter((linea) => !/^\s*#/.test(linea))
    .some((linea) => {
      const marca = linea.match(/^\s*continue-on-error\s*:\s*(.*)$/);
      return marca && marca[1].replace(/\s+#.*$/, '').trim() !== 'false';
    });
}

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

  if (disparaEnPR(workflow)) {
    errores.push('el job nocturno no debe dispararse en pull_request ni pull_request_target (no bloquea PRs)');
  }
  if (usaContinueOnError(workflow)) {
    errores.push('el workflow no debe usar continue-on-error (deja verde el run con la suite omitida)');
  }
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
