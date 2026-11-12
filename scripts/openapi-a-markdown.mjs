#!/usr/bin/env node
// Genera la referencia de la API pública (docs/api/referencia.md) a partir de `openapi/api-v1.json` (F-API-01, MSF-233).
//
// La página es DERIVADA: el contrato OpenAPI es la única fuente de verdad. `pnpm openapi:escribir` la regenera y
// `pnpm openapi:verificar` falla si quedó desactualizada, así la documentación no se separa del contrato.
//
// Uso: node scripts/openapi-a-markdown.mjs [--escribir]   (sin flag: imprime la página)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
export const CONTRATO = 'openapi/api-v1.json'
export const REFERENCIA = 'docs/api/referencia.md'

/** HTTP de cada código de error que la API devuelve (el catálogo completo, también los que el contrato no referencia). */
export const ESTADO_DEL_CODIGO = {
  token_ausente: 401,
  token_invalido: 401,
  clave_vencida: 401,
  clave_revocada: 401,
  alcance_insuficiente: 403,
  limite_excedido: 429,
  cursor_invalido: 400,
  parametro_invalido: 400,
  no_encontrado: 404,
  metodo_no_soportado: 405,
  error_interno: 500,
}

const ORDEN_METODOS = ['get', 'post']

const escaparTabla = (texto) => String(texto ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim()

function nombreDeRef(ref) {
  return String(ref).split('/').pop()
}

function tipoDe(esquema) {
  if (!esquema) return ''
  if (esquema.$ref) return `[${nombreDeRef(esquema.$ref)}](#${nombreDeRef(esquema.$ref).toLowerCase()})`
  if (esquema.const !== undefined) return `\`${JSON.stringify(esquema.const)}\``
  const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type]
  const partes = tipos.filter(Boolean).map((tipo) => {
    if (tipo === 'array') return `lista de ${tipoDe(esquema.items) || 'valores'}`
    if (tipo === 'string' && esquema.format) return `texto (${esquema.format})`
    if (tipo === 'string') return 'texto'
    if (tipo === 'number') return 'número'
    if (tipo === 'integer') return 'entero'
    if (tipo === 'boolean') return 'verdadero/falso'
    if (tipo === 'object') return 'objeto'
    if (tipo === 'null') return 'puede ser nulo'
    return tipo
  })
  return partes.join(' · ')
}

const json = (valor) => JSON.stringify(valor, null, 2)

function bloque(lenguaje, texto, sangria = '') {
  const lineas = ['```' + lenguaje, ...String(texto).split('\n'), '```']
  return lineas.map((linea) => (linea ? sangria + linea : '')).join('\n')
}

function tablaDeCampos(esquema) {
  const propiedades = esquema?.properties ?? {}
  const obligatorios = new Set(esquema?.required ?? [])
  const filas = Object.entries(propiedades).map(([nombre, campo]) => {
    const detalle = [campo.description, campo.enum ? `Valores: ${campo.enum.map((v) => `\`${v}\``).join(', ')}.` : '']
      .filter(Boolean)
      .join(' ')
    return `| \`${nombre}\` | ${escaparTabla(tipoDe(campo))} | ${obligatorios.has(nombre) ? 'sí' : 'no'} | ${escaparTabla(detalle)} |`
  })
  return ['| Campo | Tipo | Siempre viene | Qué es |', '|---|---|---|---|', ...filas].join('\n')
}

function resolver(documento, ref) {
  return String(ref)
    .replace(/^#\//, '')
    .split('/')
    .reduce((nodo, clave) => nodo?.[clave], documento)
}

function parametrosDe(documento, operacion) {
  return (operacion.parameters ?? []).map((p) => (p.$ref ? resolver(documento, p.$ref) : p))
}

function tablaDeParametros(parametros) {
  const filas = parametros.map((p) => {
    const ejemplo = p.example !== undefined ? ` Ejemplo: \`${p.example}\`.` : ''
    return `| \`${p.name}\` | ${p.in === 'header' ? 'cabecera' : 'URL'} | ${escaparTabla(tipoDe(p.schema))} | ${p.required ? 'sí' : 'no'} | ${escaparTabla((p.description ?? '') + ejemplo)} |`
  })
  return ['| Nombre | Dónde | Tipo | Obligatorio | Qué es |', '|---|---|---|---|---|', ...filas].join('\n')
}

function respuestasDe(documento, operacion) {
  return Object.entries(operacion.responses ?? {}).map(([codigo, respuesta]) => {
    const real = respuesta.$ref ? resolver(documento, respuesta.$ref) : respuesta
    const ejemplos = Object.values(real?.content?.['application/json']?.examples ?? {})
      .map((e) => e?.value?.error?.codigo)
      .filter(Boolean)
    const codigos = ejemplos.length ? ` Códigos: ${ejemplos.map((c) => `\`${c}\``).join(', ')}.` : ''
    return `| \`${codigo}\` | ${escaparTabla(real?.description ?? '')}${codigos} |`
  })
}

function operaciones(documento, coleccion) {
  const salida = []
  for (const [ruta, item] of Object.entries(coleccion ?? {})) {
    for (const metodo of ORDEN_METODOS) {
      if (item[metodo]) salida.push({ ruta, metodo, operacion: item[metodo] })
    }
  }
  return salida
}

function seccionDeLectura(documento, { ruta, metodo, operacion }) {
  const partes = [`### \`${metodo.toUpperCase()} ${ruta}\``, '', `**${operacion.summary}**`, '', operacion.description ?? '']
  const parametros = parametrosDe(documento, operacion)
  if (parametros.length) partes.push('', '**Parámetros**', '', tablaDeParametros(parametros))
  partes.push('', '**Respuestas**', '', '| Estado | Cuándo |', '|---|---|', ...respuestasDe(documento, operacion))
  const ok = operacion.responses?.['200']?.content?.['application/json']
  if (ok?.example !== undefined) partes.push('', '**Ejemplo de respuesta `200`**', '', bloque('json', json(ok.example)))
  const muestras = operacion['x-codeSamples'] ?? []
  if (muestras.length) {
    partes.push('', '**Ejemplo de llamada**', '')
    for (const muestra of muestras) {
      partes.push(`=== "${muestra.label}"`, '', bloque(muestra.lang === 'Shell' ? 'bash' : 'javascript', muestra.source, '    '), '')
    }
  }
  return partes.join('\n')
}

function seccionDeAviso(documento, nombre, { operacion }) {
  const cuerpo = operacion.requestBody?.content?.['application/json']
  const ref = cuerpo?.schema?.$ref
  const esquema = ref ? resolver(documento, ref) : null
  const partes = [`### \`${nombre}\``, '', `**${operacion.summary}**`]
  partes.push('', '**Ejemplo del cuerpo**', '', bloque('json', json(cuerpo?.example ?? {})))
  if (esquema?.properties?.datos) partes.push('', '**Campos de `datos`**', '', tablaDeCampos(esquema.properties.datos))
  return partes.join('\n')
}

/** Página completa de la referencia, a partir del documento OpenAPI. */
export function generarReferencia(documento) {
  const partes = [
    '<!-- GENERADO por scripts/openapi-a-markdown.mjs a partir de openapi/api-v1.json. No editar a mano: `pnpm openapi:escribir`. -->',
    '',
    `# Referencia de la API pública ${documento.info.version}`,
    '',
    '!!! tip "Contrato máquina-legible"',
    '    El mismo contenido está en formato OpenAPI 3.1: se sirve **sin clave** en `GET <URL de Supabase>/functions/v1/api-v1/v1/openapi.json` y se puede importar en Postman, Insomnia o un generador de clientes.',
    '',
    documento.info.description ?? '',
    '',
  ]

  partes.push('## Cómo se autentica', '')
  for (const [nombre, esquema] of Object.entries(documento.components?.securitySchemes ?? {})) {
    partes.push(`- **${nombre}** (${esquema.type === 'http' ? `HTTP ${esquema.scheme}` : `cabecera \`${esquema.name}\``}): ${esquema.description ?? ''}`)
  }


  partes.push('', '## Recursos', '')
  const lecturas = operaciones(documento, documento.paths).filter(({ operacion }) => operacion.tags?.includes('lectura'))
  for (const lectura of lecturas) partes.push(seccionDeLectura(documento, lectura), '')

  partes.push('', '## Códigos de error', '', 'Todos los errores tienen la forma `{ "error": { "codigo": "...", "mensaje": "..." } }`.', '')
  partes.push('| Código | Estado HTTP |', '|---|---|')
  for (const [codigo, estado] of Object.entries(ESTADO_DEL_CODIGO)) partes.push(`| \`${codigo}\` | ${estado} |`)

  const esquemas = documento.components?.schemas ?? {}
  partes.push('', '## Objetos de la API', '')
  for (const nombre of ['Producto', 'Stock', 'Precios', 'Venta']) {
    if (!esquemas[nombre]) continue
    partes.push(`### ${nombre}`, '', tablaDeCampos(esquemas[nombre]), '')
    if (esquemas[nombre].example) partes.push(bloque('json', json(esquemas[nombre].example)), '')
  }

  const avisos = Object.entries(documento.webhooks ?? {})
  if (avisos.length) {
    partes.push('## Avisos (webhooks)', '')
    const primero = operaciones(documento, { _: avisos[0][1] })[0]
    // El sobre es igual en los tres avisos salvo `tipo`: se muestra con los tres valores posibles, no con el del primero.
    const sobre = structuredClone(resolver(documento, primero.operacion.requestBody?.content?.['application/json']?.schema?.$ref))
    sobre.properties.tipo = { type: 'string', enum: avisos.map(([nombre]) => nombre), description: 'Tipo de evento.' }
    partes.push(primero.operacion.description ?? '', '', '**Sobre del aviso (igual en los tres eventos)**', '', tablaDeCampos(sobre), '', '**Cabeceras que recibís**', '', tablaDeParametros(parametrosDe(documento, primero.operacion)), '')
    for (const [nombre, item] of avisos) {
      const [aviso] = operaciones(documento, { _: item })
      partes.push(seccionDeAviso(documento, nombre, aviso), '')
    }
  }

  return `${partes.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function leerContrato(raiz = RAIZ) {
  return JSON.parse(readFileSync(join(raiz, CONTRATO), 'utf8'))
}

export function referenciaEsperada(raiz = RAIZ) {
  return generarReferencia(leerContrato(raiz))
}

const esCLI = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (esCLI) {
  const texto = referenciaEsperada()
  if (process.argv.includes('--escribir')) {
    const destino = join(RAIZ, REFERENCIA)
    mkdirSync(dirname(destino), { recursive: true })
    writeFileSync(destino, texto)
    console.log(`Escrito ${REFERENCIA}`)
  } else {
    process.stdout.write(texto)
  }
}
