#!/usr/bin/env node
// Guardián de los E2E: ninguna siembra ni limpieza escribe directo (INSERT/PATCH/DELETE) en las tablas de `dominio`
// que `service_role` solo puede leer.
//
// La migración 20270302105000 deja a `service_role` con SELECT nada más sobre `dominio.consultas` y las tablas de solo
// agregar (historiales, movimientos, lotes...): esos datos entran por la RPC de negocio (p. ej.
// `publico.crear_consulta_publica`) y se van con la baja de la organización (casi todas cascadean; los ingresos de
// mercadería no: ver `limpiarOrganizacion` en `apps/web/e2e/soporte/fixtures.ts`). Un `rest('consultas', ...)`, un
// `borrar('movimientos_stock', ...)` o un `fetch('/rest/v1/consultas', { method: 'POST' })` en `apps/web/e2e/**` falla con
// 403 contra una base reproducible, pero solo cuando alguien corre la suite: este guardián lo detecta en CI.
//
// Qué detecta (heurístico, por renglón y por llamada; no es un análisis de tipos):
//   1. un helper de escritura (cualquier función que no sea de lectura) con la tabla como primer argumento literal,
//      con o sin prefijo `dominio.`;
//   2. `fetch(...)` / `request.post|patch|put|delete(...)` con POST/PATCH/PUT/DELETE a `/rest/v1/<tabla>`;
//   3. SQL directo (`pg`): `insert into | update | delete from [dominio.]<tabla>`;
//   4. el nombre de la tabla guardado en una variable o arreglo y un helper de escritura llamado con una variable.
// Leer (GET, `leer(...)`, `.select`) esas tablas está permitido. Un renglón puede eximirse con el comentario
// `escritura-directa: ok — <motivo>` (mismo renglón o el anterior); sin motivo no vale.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const OBJETIVO = join(RAIZ, 'apps/web/e2e')

// Tablas de `dominio` de solo lectura para `service_role` (supabase/migrations/20270302105000_*). El test del guardián
// la compara con la lista `inalterables` del pgTAP `service_role_privilegios`: si esa crece, el test falla hasta que
// se agregue acá.
export const TABLAS_SOLO_LECTURA = [
  'consultas',
  'cotizaciones',
  'historial_comprobantes',
  'historial_cobros',
  'historial_cotizaciones_dolar',
  'movimientos_stock',
  'cargas_iniciales_stock',
  'comprobante_impresiones',
  'lotes_stock',
  'producto_costos_historial',
  'reparacion_historial',
  'precios_propios_historial',
]

const TABLAS = TABLAS_SOLO_LECTURA.join('|')
const TABLA_CON_PREFIJO = `(?:dominio\\.)?(?:${TABLAS})`
// Funciones que solo leen o consultan la pantalla: no cuentan como escritura aunque reciban el nombre de la tabla.
const LECTORAS = /^(?:leer\w*|esperar\w*|get\w*|expect|locator|goto|waitFor\w*|has\w*|contar\w*)$/
const FUENTE_LLAMADA = `\\b([A-Za-z_]\\w*)\\s*(?:<[^()]*>)?\\(\\s*(['"\`])${TABLA_CON_PREFIJO}(?:[?'"\`]|\\2)`
const LLAMADA_CON_TABLA = new RegExp(FUENTE_LLAMADA)
const LLAMADA_CON_VARIABLE = /\b(?:rest|insertar|borrar|actualizar|modificar|pedir|upsert|eliminar|sembrar)\s*(?:<[^()]*>)?\(\s*[A-Za-z_]\w*\s*[,)]/
const LLAMADA_PARTIDA = /\b([A-Za-z_]\w*)\s*(?:<[^()]*>)?\(\s*$/
const LITERAL_DE_TABLA = new RegExp(`(['"\`])${TABLA_CON_PREFIJO}(?:[?'"\`]|\\1)`)
const RUTA_REST = new RegExp(`/rest/v1/${TABLA_CON_PREFIJO}(?![A-Za-z0-9_])`)
const METODO_ESCRITURA = /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/
const PETICION_PLAYWRIGHT = /\.(?:post|patch|put|delete)\s*\(/
const SQL_DIRECTO = new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+${TABLA_CON_PREFIJO}\\b`, 'i')
const LECTURA_EN_EL_RENGLON = /\bleer\w*\s*(?:<[^()]*>)?\(|accept-profile|\bGET\b|select=|\.select\(/
const EXENCION = /escritura-directa:\s*ok\s*[—-]\s*\S+/
const COMENTARIO = /^\s*(?:\/\/|\/\*|\*)/
const IMPORT = /^\s*(?:import|export)\b/

const exentaLaLinea = (lineas, i) => EXENCION.test(lineas[i]) || (i > 0 && COMENTARIO.test(lineas[i - 1]) && EXENCION.test(lineas[i - 1]))

// Texto de la llamada que empieza en `desde` (hasta cerrar el paréntesis, máximo 14 renglones): acota la búsqueda del
// método a ESA llamada y no a los renglones vecinos.
function llamadaDesde(lineas, desde) {
  let profundidad = 0
  let abierta = false
  let texto = ''
  for (let k = desde; k < Math.min(lineas.length, desde + 14); k++) {
    for (const c of lineas[k]) {
      if (c === '(') {
        profundidad += 1
        abierta = true
      } else if (c === ')') profundidad -= 1
    }
    texto += `${lineas[k]}\n`
    if (abierta && profundidad <= 0) break
  }
  return texto
}

// Devuelve los hallazgos (línea + motivo) de un archivo de `apps/web/e2e`. Se exporta para el test (`node --test`).
export function analizar(contenido) {
  const lineas = contenido.split('\n')
  const hallazgos = []
  const marcar = (i, motivo) => {
    if (!exentaLaLinea(lineas, i) && !hallazgos.some((h) => h.linea === i + 1)) hallazgos.push({ linea: i + 1, motivo })
  }
  const literalesSueltos = []
  let hayLlamadaConVariable = false

  lineas.forEach((linea, i) => {
    if (COMENTARIO.test(linea) || IMPORT.test(linea)) return
    // 1. Helper de escritura con la tabla como primer argumento (también partido: `rest(` y la tabla en el renglón siguiente).
    const texto = LLAMADA_PARTIDA.test(linea) && i + 1 < lineas.length ? `${linea} ${lineas[i + 1].trim()}` : linea
    for (const m of texto.matchAll(new RegExp(FUENTE_LLAMADA, 'g'))) {
      if (!LECTORAS.test(m[1])) marcar(i, `escritura directa en una tabla de solo lectura para service_role (${linea.trim().slice(0, 80)})`)
    }
    // 2. fetch / request.* de Playwright a la ruta REST de la tabla, con método de escritura en ESA llamada.
    if (RUTA_REST.test(linea)) {
      let inicio = i
      while (inicio > Math.max(0, i - 2) && !/\bfetch\(|\.(?:post|patch|put|delete|fetch)\s*\(/.test(lineas[inicio])) inicio -= 1
      const llamada = llamadaDesde(lineas, inicio)
      const esPeticion = /\bfetch\(|\.fetch\(/.test(lineas[inicio]) ? METODO_ESCRITURA.test(llamada) : PETICION_PLAYWRIGHT.test(lineas[inicio])
      if (esPeticion) marcar(i, 'petición con POST/PATCH/PUT/DELETE a una tabla de solo lectura para service_role')
    }
    // 3. SQL directo.
    if (SQL_DIRECTO.test(linea)) marcar(i, 'SQL directo de escritura sobre una tabla de solo lectura para service_role')
    // 4. Nombre de la tabla en una variable o arreglo, fuera de una lectura (se cruza con las llamadas con variable).
    if (LITERAL_DE_TABLA.test(linea) && !LECTURA_EN_EL_RENGLON.test(linea) && !(i > 0 && LECTURA_EN_EL_RENGLON.test(lineas[i - 1]))) {
      if (!LLAMADA_CON_TABLA.test(linea)) literalesSueltos.push(i)
    }
    if (LLAMADA_CON_VARIABLE.test(linea) && !/function\s/.test(linea)) hayLlamadaConVariable = true
  })

  if (hayLlamadaConVariable) {
    for (const i of literalesSueltos) marcar(i, 'tabla de solo lectura guardada en una variable y un helper de escritura llamado con una variable')
  }
  return hallazgos.sort((a, b) => a.linea - b.linea)
}

function archivosDe(dir) {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) return archivosDe(ruta)
    return /\.(?:ts|mts|mjs)$/.test(entrada) ? [ruta] : []
  })
}

export function revisarE2e(objetivo = OBJETIVO) {
  const resultados = []
  for (const archivo of archivosDe(objetivo)) {
    const hallazgos = analizar(readFileSync(archivo, 'utf8'))
    if (hallazgos.length > 0) {
      resultados.push({ archivo: relative(RAIZ, archivo).split(sep).join('/'), hallazgos })
    }
  }
  return resultados
}

function main() {
  const resultados = revisarE2e()
  if (resultados.length === 0) {
    console.log('e2e-sin-escritura-directa: ningún spec escribe directo en tablas de solo lectura para service_role.')
    return
  }
  let total = 0
  for (const { archivo, hallazgos } of resultados) {
    for (const { linea, motivo } of hallazgos) {
      console.error(`${archivo}:${linea}: ${motivo}`)
      total += 1
    }
  }
  console.error(
    `\ne2e-sin-escritura-directa: ${total} hallazgo(s). Sembrá por la RPC de negocio (p. ej. publico.crear_consulta_publica) y no borres a mano: ` +
      'la baja de la organización se lleva esas filas (los ingresos de mercadería se borran antes, ver limpiarOrganizacion). ' +
      'Si de verdad hace falta, eximí el renglón con "escritura-directa: ok — <motivo>".',
  )
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
