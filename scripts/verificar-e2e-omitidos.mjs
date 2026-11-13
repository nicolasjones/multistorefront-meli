import { readFileSync } from 'node:fs';
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

const esCli = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esCli) {
  const [archivo, ...resto] = process.argv.slice(2);
  const maximo = Number(resto.find((arg) => arg.startsWith('--max='))?.slice(6) ?? 0);
  if (!archivo || !Number.isInteger(maximo) || maximo < 0) {
    console.error('Uso: node scripts/verificar-e2e-omitidos.mjs <reporte.json> [--max=N]');
    process.exit(2);
  }
  const resultado = evaluar(JSON.parse(readFileSync(archivo, 'utf8')), maximo);
  for (const omitido of resultado.omitidos) console.log(` - omitido: ${omitido.archivo} › ${omitido.titulo}`);
  console[resultado.ok ? 'log' : 'error'](resultado.mensaje);
  process.exit(resultado.ok ? 0 : 1);
}
