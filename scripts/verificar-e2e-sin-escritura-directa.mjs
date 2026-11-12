#!/usr/bin/env node
// Guardián de los E2E: ninguna siembra ni limpieza escribe directo (INSERT/PATCH/DELETE) en las tablas de `dominio`
// que `service_role` solo puede leer.
//
// La migración 20270301110000 deja a `service_role` con SELECT nada más sobre `dominio.consultas` y las tablas de solo
// agregar (historiales, movimientos, lotes...): esos datos entran por la RPC de negocio (p. ej.
// `publico.crear_consulta_publica`) y se borran con la baja de la organización, que cascadea. Un `rest('consultas', ...)`,
// un `borrar('movimientos_stock', ...)` o un `fetch('/rest/v1/consultas', { method: 'POST' })` en `apps/web/e2e/**`
// falla con 403 contra una base reproducible, pero solo cuando alguien corre la suite: este guardián lo detecta en CI.
//
// Leer (GET / `leer(...)`) esas tablas está permitido. Una línea puede eximirse con el comentario
// `escritura-directa: ok — <motivo>` (mismo renglón o el anterior); sin motivo no vale.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const OBJETIVO = join(RAIZ, 'apps/web/e2e')

// Tablas de `dominio` de solo lectura para `service_role` (supabase/migrations/20270301110000_*).
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
// Helpers de los specs que escriben (todos reciben la tabla o ruta como primer argumento literal).
const ESCRITORES = 'rest|insertar|borrar|actualizar|modificar|pedir|upsert|eliminar|sembrar'
const LLAMADA_ESCRITORA = new RegExp(`\\b(?:${ESCRITORES})\\s*(?:<[^()]*>)?\\(\\s*(['"\`])(?:${TABLAS})(?:[?'"\`]|\\1)`)
const RUTA_REST = new RegExp(`/rest/v1/(?:${TABLAS})(?![A-Za-z0-9_])`)
const METODO_ESCRITURA = /method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/
const VENTANA_FETCH = 6
const EXENCION = /escritura-directa:\s*ok\s*[—-]\s*\S+/
const COMENTARIO = /^\s*(?:\/\/|\/\*|\*)/

const exentaLaLinea = (lineas, i) => EXENCION.test(lineas[i]) || (i > 0 && EXENCION.test(lineas[i - 1]) && COMENTARIO.test(lineas[i - 1]))

// Devuelve los hallazgos (línea + motivo) de un archivo de `apps/web/e2e`. Se exporta para el test (`node --test`).
export function analizar(contenido) {
  const lineas = contenido.split('\n')
  const hallazgos = []
  lineas.forEach((linea, i) => {
    if (COMENTARIO.test(linea)) return
    let motivo = null
    // La llamada puede partirse (`rest(` y la tabla en el renglón siguiente): se prueba también la unión de ambos.
    const llamadaPartida = new RegExp(`\\b(?:${ESCRITORES})\\s*(?:<[^()]*>)?\\(\\s*$`).test(linea) && i + 1 < lineas.length
    const llamada = LLAMADA_ESCRITORA.exec(llamadaPartida ? `${linea} ${lineas[i + 1].trim()}` : linea)
    if (llamada) {
      motivo = `escritura directa en una tabla de solo lectura para service_role (${linea.trim().slice(0, 80)})`
    } else if (RUTA_REST.test(linea)) {
      const cercanas = lineas.slice(Math.max(0, i - 2), i + VENTANA_FETCH).join('\n')
      if (/\bfetch\(|\bfetch$/.test(lineas.slice(Math.max(0, i - 2), i + 1).join('\n')) && METODO_ESCRITURA.test(cercanas)) {
        motivo = 'fetch con POST/PATCH/PUT/DELETE a una tabla de solo lectura para service_role'
      }
    }
    if (motivo && !exentaLaLinea(lineas, i)) {
      hallazgos.push({ linea: i + 1, motivo })
    }
  })
  return hallazgos
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
    `\ne2e-sin-escritura-directa: ${total} hallazgo(s). Sembrá por la RPC de negocio (p. ej. publico.crear_consulta_publica) y dejá que la baja de la organización cascadee; ` +
      'si de verdad hace falta, eximí el renglón con "escritura-directa: ok — <motivo>".',
  )
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
