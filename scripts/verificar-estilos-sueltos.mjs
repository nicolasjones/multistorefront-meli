#!/usr/bin/env node
// Guardián de paridad visual (FR-015/FR-016).
//
// Falla si las pantallas (`apps/web/src/pages/**`) usan valores sueltos en vez
// de tokens: colores hex/rgba/hsl, o `borderRadius`/`height`/`minHeight`/
// `fontSize` con un valor literal.
//
// Quedan exentos los dueños de los valores: el tema (`apps/web/src/tema/**`),
// los componentes base/`pagina` y los tests; además, una línea puede acogerse a
// la excepción con el comentario `estilos-sueltos: ok` cuando el valor no es
// del sistema de diseño (p. ej. un `height: 1` de utilidad de accesibilidad).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const OBJETIVO = join(RAIZ, 'apps/web/src/pages')

// Rutas (relativas a la raíz) donde un valor suelto es legítimo: son las
// dueñas de los tokens o no son pantallas.
export const RUTAS_EXENTAS = [
  'apps/web/src/tema/',
  'apps/web/src/components/base/',
  'apps/web/src/components/pagina/',
]

const COLOR_SUELTO = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/
const DIMENSION_SUELTA = /(?<![A-Za-z_-])(borderRadius|height|minHeight|fontSize)\s*:\s*(\d+(?:\.\d+)?|'[^']*(?:px|rem|em)'|"[^"]*(?:px|rem|em)")/g
const SUPRESION = /estilos-sueltos:\s*ok/
const COMENTARIO = /^\s*(?:\/\/|\/\*|\*)/

const esExento = (rutaRelativa) =>
  RUTAS_EXENTAS.some((prefijo) => rutaRelativa.startsWith(prefijo)) ||
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rutaRelativa) ||
  rutaRelativa.endsWith('.d.ts')

// Analiza el contenido de un archivo y devuelve los hallazgos (línea + motivo).
// Se exporta para el test (`node --test`).
export function analizar(contenido, rutaRelativa = 'archivo.tsx') {
  if (esExento(rutaRelativa)) {
    return []
  }

  const hallazgos = []
  contenido.split('\n').forEach((linea, indice) => {
    if (COMENTARIO.test(linea) || SUPRESION.test(linea)) {
      return
    }
    if (COLOR_SUELTO.test(linea)) {
      hallazgos.push({ linea: indice + 1, motivo: 'color suelto (hex/rgba/hsl): usar un token de color' })
    }
    for (const coincidencia of linea.matchAll(DIMENSION_SUELTA)) {
      hallazgos.push({ linea: indice + 1, motivo: `${coincidencia[1]} suelto: usar un token de forma/dimensión o una variante del tema` })
    }
  })
  return hallazgos
}

function archivosDe(dir) {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) {
      return archivosDe(ruta)
    }
    return /\.(?:ts|tsx)$/.test(entrada) ? [ruta] : []
  })
}

export function revisarPaginas() {
  const resultados = []
  for (const archivo of archivosDe(OBJETIVO)) {
    const rutaRelativa = relative(RAIZ, archivo).split(sep).join('/')
    const hallazgos = analizar(readFileSync(archivo, 'utf8'), rutaRelativa)
    if (hallazgos.length > 0) {
      resultados.push({ archivo: rutaRelativa, hallazgos })
    }
  }
  return resultados
}

function main() {
  const resultados = revisarPaginas()
  if (resultados.length === 0) {
    console.log('estilos-sueltos: sin valores sueltos en apps/web/src/pages (FR-015).')
    return
  }

  let total = 0
  for (const { archivo, hallazgos } of resultados) {
    for (const { linea, motivo } of hallazgos) {
      console.error(`${archivo}:${linea}: ${motivo}`)
      total += 1
    }
  }
  console.error(`\nestilos-sueltos: ${total} hallazgo(s). Usá tokens del sistema de diseño o el comentario "estilos-sueltos: ok".`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
