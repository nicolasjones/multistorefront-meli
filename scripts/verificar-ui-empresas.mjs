#!/usr/bin/env node
// Guardián de consistencia de la UI de empresas/tiendas.
//
// Falla si una pantalla vuelve a implementar por su cuenta el filtro o la
// selección de empresas con `Chip`, `Select` o `Autocomplete` en lugar de los
// componentes compartidos:
//   - `FiltroEmpresa` (píldoras, un filtro de pantalla)
//   - `SelectorEmpresas` (casillas, selección múltiple en formularios/diálogos)
// El patrón de referencia es Cuentas de cobro.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const OBJETIVOS = [
  join(RAIZ, 'apps/web/src/pages'),
  join(RAIZ, 'apps/web/src/components'),
]

const esExento = (rutaRelativa) =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rutaRelativa) ||
  rutaRelativa.endsWith('.d.ts')

// Extrae las etiquetas de apertura `<Nombre ...>` respetando strings, template
// literals y llaves anidadas (un `>` dentro de `onClick={() => ...}` no corta).
function etiquetasDeApertura(contenido, nombre) {
  const etiquetas = []
  const inicio = new RegExp(`<${nombre}\\b`, 'g')
  let coincidencia
  while ((coincidencia = inicio.exec(contenido)) !== null) {
    const desde = coincidencia.index
    let i = desde + coincidencia[0].length
    let profundidad = 0
    let comilla = null
    for (; i < contenido.length; i++) {
      const caracter = contenido[i]
      if (comilla) {
        if (caracter === '\\') {
          i += 1
          continue
        }
        if (caracter === comilla) comilla = null
        continue
      }
      if (caracter === '"' || caracter === "'" || caracter === '`') {
        comilla = caracter
        continue
      }
      if (caracter === '{') {
        profundidad += 1
        continue
      }
      if (caracter === '}') {
        profundidad -= 1
        continue
      }
      if (caracter === '>' && profundidad === 0) break
    }
    etiquetas.push({ texto: contenido.slice(desde, i + 1), desde })
  }
  return etiquetas
}

const numeroDeLinea = (contenido, indice) => contenido.slice(0, indice).split('\n').length

export function analizar(contenido, rutaRelativa = 'archivo.tsx') {
  if (esExento(rutaRelativa)) return []

  const hallazgos = []
  const agregar = (indice, motivo) => hallazgos.push({ linea: numeroDeLinea(contenido, indice), motivo })

  for (const { texto, desde } of etiquetasDeApertura(contenido, 'Chip')) {
    const etiquetaDeEmpresa =
      /label\s*=\s*["']Todas (?:las )?(?:tiendas|empresas)["']/.test(texto) ||
      /label\s*=\s*\{?[^}]*\b(?:empresa|tienda|opcion)\.nombre/.test(texto)
    if (etiquetaDeEmpresa && /\baria-pressed\s*=/.test(texto)) {
      agregar(desde, 'Chip con aria-pressed para elegir una empresa/tienda: usá FiltroEmpresa o SelectorEmpresas')
    } else if (etiquetaDeEmpresa && /\bclickable\b/.test(texto) && /\bonClick\s*=/.test(texto)) {
      agregar(desde, 'Chip clickable para elegir una empresa/tienda: usá SelectorEmpresas')
    }
  }

  for (const nombre of ['TextField', 'Autocomplete']) {
    for (const { texto, desde } of etiquetasDeApertura(contenido, nombre)) {
      if (/\blabel\s*=\s*["']Tienda["']/.test(texto)) {
        agregar(desde, `${nombre} con label «Tienda»: usá FiltroEmpresa`)
      }
    }
  }

  // Una pantalla que administra el filtro (valor/cambiar) debe renderizar el
  // componente compartido. `depositos.tsx`, que sólo lee `empresaActivaId`,
  // queda afuera.
  if (
    /\buseFiltroPorEmpresaActiva\b/.test(contenido) &&
    /\b(?:valor|cambiar)\s*[:,]/.test(contenido) &&
    !/<Filtro(?:Empresa|Tienda)\b/.test(contenido) &&
    !/<FiltrosListado\b[\s\S]{0,800}?\bonEmpresa\s*=/.test(contenido)
  ) {
    hallazgos.push({
      linea: numeroDeLinea(contenido, contenido.search(/\buseFiltroPorEmpresaActiva\b/)),
      motivo: 'usa useFiltroPorEmpresaActiva sin FiltroEmpresa/FiltroTienda: el filtro debe ser el componente compartido',
    })
  }

  return hallazgos
}

function archivosDe(dir) {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) return archivosDe(ruta)
    return /\.(?:ts|tsx)$/.test(entrada) ? [ruta] : []
  })
}

export function revisarUI() {
  const resultados = []
  for (const objetivo of OBJETIVOS) {
    for (const archivo of archivosDe(objetivo)) {
      const rutaRelativa = relative(RAIZ, archivo).split(sep).join('/')
      const hallazgos = analizar(readFileSync(archivo, 'utf8'), rutaRelativa)
      if (hallazgos.length > 0) resultados.push({ archivo: rutaRelativa, hallazgos })
    }
  }
  return resultados
}

function main() {
  const resultados = revisarUI()
  if (resultados.length === 0) {
    console.log('ui-empresas: filtros y selectores de empresa usan los componentes compartidos.')
    return
  }

  let total = 0
  for (const { archivo, hallazgos } of resultados) {
    for (const { linea, motivo } of hallazgos) {
      console.error(`${archivo}:${linea}: ${motivo}`)
      total += 1
    }
  }
  console.error(`\nui-empresas: ${total} hallazgo(s). Usá FiltroEmpresa o SelectorEmpresas (patrón de Cuentas de cobro).`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
