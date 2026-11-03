#!/usr/bin/env node
// Baja las fotos de los productos del cliente (para subirlas después al bucket de la tienda).
//
// El CSV de precios trae las fotos con la ruta vieja del panel («/panel/uploads/…»); en la web actual están en
// «/uploads/…». Deja los archivos en una carpeta y el mapeo (JSON) que usa el módulo 02 del dataset para subirlos
// al bucket con la ruta que exige la base (<organización>/<producto>/archivo) y cargar `dominio.producto_imagenes`.
//
//   node scripts/demo-dataset/bajar-imagenes.mjs <csv-precios> <json-salida> <carpeta-local>
//
// Variables: PARALELO (descargas simultáneas, por defecto 24). Es reanudable: lo que ya está bajado no se vuelve a bajar.
import { mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { leerPreciosCliente } from './lib/csvCliente.mjs'

const [, , RUTA_CSV, RUTA_SALIDA = '/tmp/demo-imagenes.json', CARPETA = '/imgs'] = process.argv
const PARALELO = Number(process.env.PARALELO ?? 24)

const nombreDe = (url) => {
  const archivo = decodeURIComponent(url.split('/').pop() ?? '').replace(/[/\\]/g, '_').trim()
  const ext = (archivo.match(/\.(jpe?g|png|gif|webp)$/i)?.[1] ?? 'jpg').toLowerCase()
  return { ext, hash: createHash('sha1').update(url).digest('hex').slice(0, 12) }
}

async function descargar(url, destino) {
  if (existsSync(destino) && statSync(destino).size > 0) return true
  const corregida = url.replace('/panel/uploads/', '/uploads/')
  const control = new AbortController()
  const t = setTimeout(() => control.abort(), 45000)
  try {
    const r = await fetch(corregida, { signal: control.signal, redirect: 'follow' })
    if (!r.ok) return false
    await pipeline(Readable.fromWeb(r.body), createWriteStream(destino))
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

const productos = leerPreciosCliente(RUTA_CSV).productos
mkdirSync(CARPETA, { recursive: true })
console.log(`productos con fotos: ${productos.filter((p) => p.imagenes.length).length}`)

const tareas = []
for (const p of productos) {
  for (const [i, url] of p.imagenes.entries()) {
    const { ext, hash } = nombreDe(url)
    tareas.push({ sku: p.codigo, posicion: i + 1, hash, ext, url, archivo: `${CARPETA}/${p.codigo}-${i + 1}.${ext}` })
  }
}
console.log(`fotos a bajar: ${tareas.length}`)

let bajadas = 0
let fallidas = 0
const cola = [...tareas]
const workers = Array.from({ length: PARALELO }, async () => {
  while (cola.length) {
    const t = cola.shift()
    const ok = await descargar(t.url, t.archivo)
    if (ok) bajadas++
    else fallidas++
    if ((bajadas + fallidas) % 100 === 0) console.log(`  ${bajadas + fallidas}/${tareas.length} (fallidas ${fallidas})`)
  }
})
await Promise.all(workers)

const filas = tareas.filter((t) => existsSync(t.archivo))
// El mapeo que lee el módulo 02 del dataset: sku -> [{posicion, archivo, hash, ext}].
const porSku = {}
for (const t of filas) {
  ;(porSku[t.sku] ??= []).push({ posicion: t.posicion, archivo: `${t.sku}-${t.posicion}.${t.ext}`, hash: t.hash, ext: t.ext })
}
for (const lista of Object.values(porSku)) lista.sort((a, b) => a.posicion - b.posicion)
writeFileSync(RUTA_SALIDA, JSON.stringify(porSku))
console.log(`✓ ${bajadas} bajadas, ${fallidas} fallidas → ${RUTA_SALIDA}`)
