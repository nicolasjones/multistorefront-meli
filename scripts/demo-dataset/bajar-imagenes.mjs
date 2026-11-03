#!/usr/bin/env node
// Baja las fotos de los productos del cliente y las sube al bucket de la tienda del entorno dev.
//
// El CSV de precios trae las fotos con la ruta vieja del panel («/panel/uploads/…»); en la web actual están en
// «/uploads/…». Después de subirlas, deja el CSV de imágenes (sku, posición, ruta en el bucket) que usa el paso SQL
// del dataset para cargar `dominio.producto_imagenes`.
//
//   node scripts/demo-dataset/bajar-imagenes.mjs <csv-precios> <csv-salida> <carpeta-local>
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (subir al bucket), BUCKET (por defecto
// 'productos-imagenes'), PARALELO (descargas simultáneas, por defecto 24).
import { mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { leerPreciosCliente } from './lib/csvCliente.mjs'

const [, , RUTA_CSV, RUTA_SALIDA = '/tmp/demo-imagenes.csv', CARPETA = '/imgs'] = process.argv
const API = process.env.SUPABASE_URL
const LLAVE = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
const BUCKET = process.env.BUCKET ?? 'productos-imagenes'
const PARALELO = Number(process.env.PARALELO ?? 24)

const nombreDe = (url, i) => {
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

async function subir(ruta, archivo, tipo) {
  const datos = await readFile(archivo)
  const r = await fetch(`${API}/storage/v1/object/${BUCKET}/${ruta}`, {
    method: 'POST',
    headers: { apikey: LLAVE, authorization: `Bearer ${LLAVE}`, 'content-type': tipo, 'x-upsert': 'true' },
    body: datos,
  })
  return r.ok
}

const productos = leerPreciosCliente(RUTA_CSV).productos
mkdirSync(CARPETA, { recursive: true })
console.log(`productos con fotos: ${productos.filter((p) => p.imagenes.length).length}`)

const tareas = []
for (const p of productos) {
  for (const [i, url] of p.imagenes.entries()) {
    const { ext, hash } = nombreDe(url, i)
    const ruta = `catalogo/${p.codigo}-${i + 1}-${hash}.${ext}`
    tareas.push({ sku: p.codigo, posicion: i + 1, ruta, url, archivo: `${CARPETA}/${p.codigo}-${i + 1}.${ext}` })
  }
}
console.log(`fotos a bajar y subir: ${tareas.length}`)

let bajadas = 0, subidas = 0, fallidas = 0
const cola = [...tareas]
const workers = Array.from({ length: PARALELO }, async () => {
  while (cola.length) {
    const t = cola.shift()
    const ok = await descargar(t.url, t.archivo)
    if (!ok) { fallidas++; continue }
    bajadas++
    if (await subir(t.ruta, t.archivo, 'image/jpeg')) subidas++
    else fallidas++
    if ((bajadas + fallidas) % 100 === 0) console.log(`  ${bajadas + fallidas}/${tareas.length} (subidas ${subidas}, fallidas ${fallidas})`)
  }
})
await Promise.all(workers)

const filas = tareas.filter((t) => existsSync(t.archivo))
writeFileSync(RUTA_SALIDA, ['sku,posicion,ruta', ...filas.map((t) => `${t.sku},${t.posicion},"${t.ruta}"`)].join('\n') + '\n')
// Y el mismo mapeo en JSON, que es lo que lee el módulo 02 del dataset.
const porSku = {}
for (const t of filas) (porSku[t.sku] ??= []).push({ posicion: t.posicion, ruta: t.ruta })
writeFileSync(RUTA_SALIDA.replace(/\.csv$/, '.json'), JSON.stringify(porSku))
console.log(`✓ ${bajadas} bajadas, ${subidas} subidas, ${fallidas} fallidas → ${RUTA_SALIDA}`)
