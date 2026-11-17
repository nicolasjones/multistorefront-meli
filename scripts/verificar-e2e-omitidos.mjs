import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Guarda contra omisiones masivas del E2E (job `e2e-tienda`): 18 specs de la tienda se omiten a nivel `describe`
// cuando faltan `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, y Playwright cuenta esas omisiones como éxito. Si el
// entorno del job se rompe, todo daría verde sin verificar nada. Este script lee el reporte JSON de Playwright y
// falla si hay más omitidos que los permitidos (en el CI, solo el caso de `tienda-seo` con `E2E_SIN_EDGE=1`) o si no
// corrió ningún test.

const recorrer = (suite, acumulado) => {
  for (const spec of suite.specs ?? []) {
    for (const prueba of spec.tests ?? []) {
      acumulado.push({ titulo: spec.title, archivo: spec.file ?? suite.file, estado: prueba.status });
    }
  }
  for (const hija of suite.suites ?? []) recorrer({ ...hija, file: hija.file ?? suite.file }, acumulado);
  return acumulado;
};

export function resumir(reporte) {
  const pruebas = (reporte.suites ?? []).flatMap((suite) => recorrer(suite, []));
  const omitidos = pruebas.filter((prueba) => prueba.estado === 'skipped');
  return { total: pruebas.length, omitidos, corridos: pruebas.length - omitidos.length };
}

export function evaluar(reporte, maximoOmitidos) {
  const { total, omitidos, corridos } = resumir(reporte);
  if (total === 0 || corridos === 0) return { ok: false, mensaje: 'No corrió ningún test del E2E.', omitidos };
  if (omitidos.length > maximoOmitidos) {
    return { ok: false, mensaje: `Hay ${omitidos.length} tests omitidos y se permiten ${maximoOmitidos}: el entorno del job no está completo.`, omitidos };
  }
  return { ok: true, mensaje: `E2E sin omisiones inesperadas: ${corridos} corridos, ${omitidos.length} omitidos (máximo ${maximoOmitidos}).`, omitidos };
}

// MSF-928: además del tope global, `--requeridos=a.e2e.ts,b.e2e.ts` exige que ESOS specs hayan corrido: si un test de uno se omitió
// (o el spec no aparece en el reporte) el job falla aunque el total de omitidos esté bajo el tope. Cada spec que el job debe correr
// se nombra, así un `test.skip` por entorno incompleto no pasa en verde.
export function evaluarRequeridos(reporte, requeridos) {
  const pruebas = (reporte.suites ?? []).flatMap((suite) => recorrer(suite, []));
  const problemas = [];
  for (const requerido of requeridos) {
    const delSpec = pruebas.filter((prueba) => String(prueba.archivo ?? '').endsWith(requerido));
    if (delSpec.length === 0) problemas.push(`${requerido}: no aparece en el reporte (no corrió).`);
    else {
      const omitidos = delSpec.filter((prueba) => prueba.estado === 'skipped');
      if (omitidos.length > 0) problemas.push(`${requerido}: ${omitidos.length} de ${delSpec.length} tests omitidos (${omitidos.slice(0, 3).map((o) => o.titulo).join('; ')}).`);
    }
  }
  return problemas;
}

// Resumen en Markdown (para $GITHUB_STEP_SUMMARY): cuántos corrieron y cuántos se omitieron, por archivo.
export function resumenMarkdown(reporte) {
  const pruebas = (reporte.suites ?? []).flatMap((suite) => recorrer(suite, []));
  const porArchivo = new Map();
  for (const prueba of pruebas) {
    const fila = porArchivo.get(prueba.archivo) ?? { corridos: 0, omitidos: 0 };
    if (prueba.estado === 'skipped') fila.omitidos += 1; else fila.corridos += 1;
    porArchivo.set(prueba.archivo, fila);
  }
  const total = pruebas.length;
  const omitidos = pruebas.filter((prueba) => prueba.estado === 'skipped').length;
  const lineas = ['### E2E: tests corridos y omitidos', '', `${total - omitidos} corridos, ${omitidos} omitidos de ${total}.`, ''];
  if (omitidos > 0) {
    lineas.push('| Archivo | Corridos | Omitidos |', '|---|---|---|');
    for (const [archivo, { corridos, omitidos: o }] of [...porArchivo].filter(([, f]) => f.omitidos > 0)) lineas.push(`| \`${archivo}\` | ${corridos} | ${o} |`);
  }
  return `${lineas.join('\n')}\n`;
}

const esCli = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esCli) {
  const [archivo, ...resto] = process.argv.slice(2);
  const maximo = Number(resto.find((arg) => arg.startsWith('--max='))?.slice(6) ?? 0);
  if (!archivo || !Number.isInteger(maximo) || maximo < 0) {
    console.error('Uso: node scripts/verificar-e2e-omitidos.mjs <reporte.json> [--max=N]');
    process.exit(2);
  }
  const reporte = JSON.parse(readFileSync(archivo, 'utf8'));
  const resultado = evaluar(reporte, maximo);
  for (const omitido of resultado.omitidos) console.log(` - omitido: ${omitido.archivo} › ${omitido.titulo}`);
  console[resultado.ok ? 'log' : 'error'](resultado.mensaje);
  const requeridos = (resto.find((arg) => arg.startsWith('--requeridos='))?.slice(13) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const problemas = evaluarRequeridos(reporte, requeridos);
  for (const problema of problemas) console.error(`Spec requerido omitido: ${problema}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumenMarkdown(reporte));
  process.exit(resultado.ok && problemas.length === 0 ? 0 : 1);
}
