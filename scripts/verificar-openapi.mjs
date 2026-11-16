#!/usr/bin/env node
// Guard de contratos OpenAPI (F-API-01, T007, FR-005, SC-004).
//
//   1. SINCRONÍA: cada Edge Function con contrato publica `openapi/<funcion>.json`,
//      copia exacta de `supabase/functions/<funcion>/openapi.json` (el que viaja
//      con la función al desplegarse). Si se edita el contrato hay que
//      regenerar el publicado (`--escribir`).
//   2. COBERTURA: el documento de `api-v1` describe TODAS las rutas del handler
//      (las de lectura y el contrato). Un endpoint sin documentar es un
//      contrato incompleto.
//   2b. REFERENCIA: `docs/api/referencia.md` es DERIVADA del contrato publicado
//      (`scripts/openapi-a-markdown.mjs`): si quedó desactualizada falla, así la
//      documentación no se separa del contrato (`--escribir` la regenera).
//   3. ROMPIMIENTO: un cambio incompatible (una ruta que desaparece, una
//      respuesta que se cae, un parámetro nuevo obligatorio) exige `BREAKING:`
//      en el commit o en el PR (D-4: los cambios aditivos no rompen `v1`).
//
// Uso: node scripts/verificar-openapi.mjs [--escribir]

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REFERENCIA, referenciaEsperada } from './openapi-a-markdown.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

/** Función ↔ contrato publicado. */
export const CONTRATOS = [
  { funcion: 'api-v1', publicado: 'openapi/api-v1.json' },
  { funcion: 'entregar-webhook', publicado: 'openapi/entregar-webhook.json' },
]

const rutaFuente = (funcion) => join(RAIZ, 'supabase/functions', funcion, 'openapi.json')
const rutaPublicada = (publicado) => join(RAIZ, publicado)

export function leerDocumento(ruta) {
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

/** Documentos publicados que no son copia exacta del que viaja con la función. */
export function contratosDesalineados(raiz = RAIZ) {
  const desalineados = []
  for (const contrato of CONTRATOS) {
    const fuente = join(raiz, 'supabase/functions', contrato.funcion, 'openapi.json')
    const publicado = join(raiz, contrato.publicado)
    if (!existsSync(fuente)) {
      desalineados.push({ ...contrato, motivo: `falta ${relative(raiz, fuente)}` })
      continue
    }
    if (!existsSync(publicado)) {
      desalineados.push({ ...contrato, motivo: `falta ${contrato.publicado}` })
      continue
    }
    if (readFileSync(fuente, 'utf8').trim() !== readFileSync(publicado, 'utf8').trim()) {
      desalineados.push({ ...contrato, motivo: `${contrato.publicado} no es copia de ${relative(raiz, fuente)}` })
    }
  }
  return desalineados
}

/** Rutas del handler que el documento no describe. */
export function rutasSinDocumentar(documento, rutas) {
  const documentadas = Object.keys(documento?.paths ?? {})
  return rutas.filter((ruta) => !documentadas.includes(ruta))
}

/** Versión de OpenAPI: la historia exige 3.1. */
export function versionInvalida(documento) {
  const version = String(documento?.openapi ?? '')
  return version.startsWith('3.1') ? null : `openapi "${version}" (se exige 3.1)`
}

/**
 * Cambios incompatibles entre dos versiones del contrato: los que obligan a
 * los sistemas que ya lo consumen a cambiar algo (D-4).
 */
export function cambiosIncompatibles(anterior, nuevo) {
  const cambios = []
  const rutasAnteriores = Object.keys(anterior?.paths ?? {})
  const rutasNuevas = Object.keys(nuevo?.paths ?? {})

  for (const ruta of rutasAnteriores) {
    if (!rutasNuevas.includes(ruta)) {
      cambios.push(`se quitó la ruta ${ruta}`)
      continue
    }
    const operacionesAnteriores = Object.keys(anterior.paths[ruta] ?? {})
    const operacionesNuevas = Object.keys(nuevo.paths[ruta] ?? {})
    for (const operacion of operacionesAnteriores) {
      const antes = anterior.paths[ruta][operacion] ?? {}
      const ahora = nuevo.paths[ruta][operacion] ?? {}
      const respuestasAntes = Object.keys(antes.responses ?? {})
      const respuestasAhora = Object.keys(ahora.responses ?? {})
      for (const respuesta of respuestasAntes) {
        if (!respuestasAhora.includes(respuesta)) {
          cambios.push(`se quitó la respuesta ${respuesta} de ${ruta} ${operacion}`)
        }
      }
      const obligatorios = (def) =>
        (def?.parameters ?? []).filter((p) => p?.required === true).map((p) => p?.name).sort()
      const nuevosObligatorios = obligatorios(ahora).filter((nombre) => !obligatorios(antes).includes(nombre))
      for (const nombre of nuevosObligatorios) {
        cambios.push(`se agregó el parámetro obligatorio ${nombre} en ${ruta} ${operacion}`)
      }
    }
  }

  return cambios
}

/** El commit o el PR tienen que avisar el rompimiento. */
export function tieneRompimiento(texto) {
  return /BREAKING:/i.test(texto ?? '')
}

/** Base del control de rompimiento: la rama del PR o `main` (nunca `dokploy`). */
export function baseDeComparacion(entorno = process.env) {
  return entorno.GITHUB_BASE_REF ? `origin/${entorno.GITHUB_BASE_REF}` : 'origin/main'
}

const git = (args) => spawnSync('git', args, { encoding: 'utf8', cwd: RAIZ })

function textoDelCambio(base) {
  const mensajes = git(['log', `${base}..HEAD`, '--format=%B']).stdout ?? ''
  let cuerpoDelPr = ''
  const evento = process.env.GITHUB_EVENT_PATH
  if (evento && existsSync(evento)) {
    try {
      cuerpoDelPr = JSON.parse(readFileSync(evento, 'utf8'))?.pull_request?.body ?? ''
    } catch {
      cuerpoDelPr = ''
    }
  }
  return `${mensajes}\n${cuerpoDelPr}`
}

const esCLI = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]

if (esCLI) {
  const escribir = process.argv.includes('--escribir')
  const problemas = []

  if (escribir) {
    for (const contrato of CONTRATOS) {
      const fuente = rutaFuente(contrato.funcion)
      if (!existsSync(fuente)) {
        console.error(`Falta el contrato de ${contrato.funcion}: ${relative(RAIZ, fuente)}`)
        process.exit(1)
      }
      const destino = rutaPublicada(contrato.publicado)
      mkdirSync(dirname(destino), { recursive: true })
      writeFileSync(destino, `${readFileSync(fuente, 'utf8').trim()}\n`)
      console.log(`Escrito ${contrato.publicado}`)
    }
    mkdirSync(dirname(join(RAIZ, REFERENCIA)), { recursive: true })
    writeFileSync(join(RAIZ, REFERENCIA), referenciaEsperada())
    console.log(`Escrito ${REFERENCIA}`)
  } else {
    for (const desalineado of contratosDesalineados()) {
      problemas.push(`${desalineado.publicado}: ${desalineado.motivo}`)
    }

    // Referencia: la página generada coincide con el contrato publicado.
    const rutaReferencia = join(RAIZ, REFERENCIA)
    if (!existsSync(rutaReferencia) || readFileSync(rutaReferencia, 'utf8') !== referenciaEsperada()) {
      problemas.push(`${REFERENCIA}: desactualizada respecto de openapi/api-v1.json (corré \`pnpm openapi:escribir\`)`)
    }

    // Cobertura: el documento de `api-v1` tiene que describir todas las rutas
    // del handler (las de lectura y el contrato).
    const { RUTAS, RUTA_CONTRATO } = await import('../supabase/functions/api-v1/handler.ts')
    const documento = leerDocumento(rutaPublicada('openapi/api-v1.json'))
    const problemaVersion = versionInvalida(documento)
    if (problemaVersion) problemas.push(`openapi/api-v1.json: ${problemaVersion}`)
    for (const ruta of rutasSinDocumentar(documento, [...Object.keys(RUTAS), RUTA_CONTRATO])) {
      problemas.push(`openapi/api-v1.json: no describe la ruta ${ruta}`)
    }

    // Rompimiento: contra la base, un cambio incompatible exige `BREAKING:`.
    const base = baseDeComparacion()
    if (git(['rev-parse', '--verify', '--quiet', base]).status === 0) {
      const texto = textoDelCambio(base)
      for (const contrato of CONTRATOS) {
        const anterior = git(['show', `${base}:${contrato.publicado}`])
        if (anterior.status !== 0) continue
        const cambios = cambiosIncompatibles(JSON.parse(anterior.stdout), leerDocumento(rutaPublicada(contrato.publicado)))
        if (cambios.length > 0 && !tieneRompimiento(texto)) {
          problemas.push(
            `${contrato.publicado}: cambio incompatible sin \`BREAKING:\` en el commit o en el PR (${cambios.join('; ')})`,
          )
        }
      }
    } else {
      console.warn(`aviso: no existe la base ${base}: se omite el control de rompimiento`)
    }
  }

  if (problemas.length) {
    console.error('Contratos OpenAPI: revisar antes de mergear')
    for (const problema of problemas) console.error(` - ${problema}`)
    process.exit(1)
  }

  console.log(`Contratos OpenAPI: OK (${CONTRATOS.length} contrato(s)).`)
}
