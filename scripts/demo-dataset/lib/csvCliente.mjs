// Lector del CSV de precios de San Javucho (export de su panel: «PRECIOS SANJAVUCHO - productos web»).
//
// El archivo no es un CSV regular: la columna «Descripción» trae saltos de línea y las comas no siempre están
// cerradas, así que un lector estándar ve miles de filas fantasma. Además algunas filas traen un campo numérico de
// más. Por eso el archivo se lee con anclas y no por posición:
//
//   · Registros: cada uno arranca en una línea cuyo primer campo es un código (números y, a veces, una letra)
//     y termina donde empieza el registro siguiente.
//   · Cola (9 campos): se lee desde la derecha, donde las columnas tienen forma reconocible —
//     sub subcategoría, subcategoría, categoría, código de barras, destacado, video, imagen 3, imagen 2, imagen 1.
//   · Cabeza (13 campos): código, nombre, precio, costo, precio x5/x10/x50, stock local, stock depósito,
//     id categoría, id subcategoría, id subsubcategoría, id proveedor.
//   · Descripción: lo que queda en el medio (descartando los campos numéricos sueltos que agrega el export).
//
// Columnas del archivo (23): código, nombre, precio, costo, precio x5, precio x10, precio x50, stock local,
// stock depósito, id categoría, id subcategoría, id subsubcategoría, id proveedor, descripción, imagen 1, imagen 2,
// imagen 3, video, destacado, código de barras, categoría, subcategoría, sub subcategoría.

import { readFileSync } from 'node:fs'

// Un código del panel: números y, a veces, una letra al final (6187a, 1328a, 1196A).
const RE_CODIGO = /^\s*\d{1,6}[A-Za-z]?\s*$/
const RE_DESTACADO = /^\s*(si|sí|no)\s*$/i
const RE_URL = /^\s*https?:\/\//i

export function numero(bruto) {
  if (bruto === undefined || bruto === null) return null
  const s = String(bruto).trim().replace(/\s/g, '')
  if (!s) return null
  let limpio = s
  if (limpio.includes(',') && limpio.includes('.')) limpio = limpio.replace(/\./g, '').replace(',', '.')
  else if (limpio.includes(',')) limpio = limpio.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) limpio = limpio.replace(/\./g, '')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

const esVacio = (v) => (v ?? '').trim() === ''
const esDigitos = (v) => /^\s*\d+\s*$/.test(v ?? '')
// El export deja comillas sueltas: las de la descripción multilínea y las de algunos nombres.
const limpiar = (v) => (v ?? '').replace(/^[\s"]+/, '').replace(/[\s"]+$/, '')

// La cola se ancla por la derecha: cada campo tiene una forma que lo delata.
function leerCola(campos) {
  const fin = (i) => limpiar(campos[campos.length - i]) // 1 = el último
  const subSub = fin(1)
  const sub = fin(2)
  const cat = fin(3)
  const barcode = fin(4)
  const destacado = fin(5)
  const video = fin(6)
  const img3 = fin(7)
  const img2 = fin(8)
  const img1 = fin(9)
  const ok =
    (RE_DESTACADO.test(destacado) || esVacio(destacado)) &&
    (esDigitos(barcode) || esVacio(barcode)) &&
    (RE_URL.test(video) || esVacio(video)) &&
    (RE_URL.test(img3) || esVacio(img3)) &&
    (RE_URL.test(img2) || esVacio(img2)) &&
    (RE_URL.test(img1) || esVacio(img1))
  if (!ok) return null
  return {
    cat, sub, subSub, barcode, destacado, video,
    imagenes: [img1, img2, img3].filter((u) => RE_URL.test(u)),
  }
}

// El separador correcto es el que deja la cabeza con números y la cola con un «destacado» válido.
function separadorDe(bloque) {
  for (const sep of [';', ',']) {
    const campos = bloque.split(sep)
    if (campos.length < 20) continue
    if (numero(campos[2]) === null) continue
    const cola = leerCola(campos)
    if (cola) return sep
  }
  return ';'
}

export function leerPreciosCliente(ruta) {
  const texto = readFileSync(ruta, 'utf8').replace(/^﻿/, '')
  const lineas = texto.split(/\r?\n/)

  // 1) Registros anclados por el código.
  const bloques = []
  let actual = null
  for (const linea of lineas.slice(1)) {
    const primero = (linea.split(/[;,]/)[0] ?? '').trim()
    if (RE_CODIGO.test(primero)) {
      if (actual !== null) bloques.push(actual)
      actual = linea
    } else if (actual !== null) {
      actual += `\n${linea}`
    }
  }
  if (actual) bloques.push(actual)

  // 2) Cada bloque con su separador.
  const cuenta = new Map()
  for (const bloque of bloques) {
    const sep = separadorDe(bloque)
    cuenta.set(sep, (cuenta.get(sep) ?? 0) + 1)
  }
  const sepPrincipal = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ';'

  const productos = []
  const duplicados = []
  const raros = []
  const vistos = new Map()
  for (const bloque of bloques) {
    const campos = bloque.split(separadorDe(bloque))
    const cola = leerCola(campos)
    const codigo = (campos[0] ?? '').trim()
    if (!cola || !RE_CODIGO.test(codigo)) { raros.push(codigo || '(sin código)'); continue }

    // La descripción: lo que queda entre la cabeza y la cola, sin los campos numéricos sueltos del export.
    const medio = campos.slice(13, campos.length - 9)
    let ini = 0
    while (ini < medio.length && (esVacio(medio[ini]) || numero(medio[ini]) !== null)) ini++
    const descripcion = medio.slice(ini).join(separadorDe(bloque)).replace(/\s*\r?\n\s*/g, ' ').trim()

    const p = {
      codigo,
      nombre: limpiar(campos[1]),
      precio: numero(campos[2]),
      costo: numero(campos[3]),
      precioX5: numero(campos[4]),
      precioX10: numero(campos[5]),
      precioX50: numero(campos[6]),
      stockLocal: numero(campos[7]),
      stockDeposito: numero(campos[8]),
      idCategoria: limpiar(campos[9]),
      idSubcategoria: limpiar(campos[10]),
      idSubSubcategoria: limpiar(campos[11]),
      idProveedor: limpiar(campos[12]),
      descripcion,
      imagenes: cola.imagenes,
      video: cola.video,
      destacado: ['si', 'sí'].includes(cola.destacado.toLowerCase()),
      codigoBarras: cola.barcode,
      categoria: cola.cat,
      subcategoria: cola.sub,
      subSubcategoria: cola.subSub,
    }
    if (vistos.has(p.codigo)) {
      duplicados.push(p.codigo)
      continue // el primero gana: el resto difiere solo en imágenes o stock
    }
    vistos.set(p.codigo, p)
    productos.push(p)
  }

  return {
    productos,
    duplicados,
    raros,
    conStock: productos.filter((p) => (p.stockLocal ?? 0) > 0 || (p.stockDeposito ?? 0) > 0).length,
    sinPrecio: productos.filter((p) => !p.precio || p.precio <= 0).map((p) => p.codigo),
    categorias: [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort(),
    proveedores: [...new Set(productos.map((p) => p.idProveedor).filter(Boolean))].sort(),
    separador: sepPrincipal,
  }
}
