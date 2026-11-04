// Lector del CSV de precios de San Javucho (export de su panel: «PRECIOS SANJAVUCHO - productos web»).
//
// El archivo no es un CSV regular: cada fila termina en «;;;;;;», la columna «Descripción» trae saltos de línea y las
// comas no siempre están cerradas, y algunos nombres traen comas. Por eso el archivo se lee por filas y no por
// campos sueltos:
//
//   · Una fila va desde su línea de código hasta la línea que termina en «;;;;;;» (las líneas intermedias son la
//     descripción con saltos de línea).
//   · La cabeza (código, nombre, precio, costo, precio x5/x10/x50, stock local, stock depósito, id categoría,
//     id subcategoría, id subsubcategoría, id proveedor) se ubica desde la izquierda: el nombre puede traer comas,
//     así que la cabeza se cierra donde arranca la corrida de once campos numéricos (precio..id proveedor).
//   · La cola (imagen 1..3, video, destacado, código de barras, categoría, subcategoría, sub subcategoría) se ancla
//     por la derecha, donde cada campo tiene una forma reconocible.
//
// Columnas del archivo (23): código, nombre, precio, costo, precio x5, precio x10, precio x50, stock local,
// stock depósito, id categoría, id subcategoría, id subsubcategoría, id proveedor, descripción, imagen 1, imagen 2,
// imagen 3, video, destacado, código de barras, categoría, subcategoría, sub subcategoría.

import { readFileSync } from 'node:fs'

const RE_CODIGO = /^\s*\d{1,6}[A-Za-z]?\s*$/
const RE_INICIO = /^\s*"?\s*\d{1,6}[A-Za-z]?\s*[,;]/
const RE_DESTACADO = /^\s*(si|sí|no)\s*$/i
const RE_URL = /^\s*https?:\/\//i
const RE_NUMERO = /^\s*-?\d+(?:[.,]\d+)?\s*$/

const esVacio = (v) => (v ?? '').trim() === ''
const esNumero = (v) => RE_NUMERO.test(v ?? '')
const esNumeroOCorto = (v) => esVacio(v) || esNumero(v)
// El export del panel viene con las comillas dobladas («""nombre""») y a veces sin cerrar: se limpian.
const limpiar = (v) => (v ?? '').replace(/^[\s"]+/, '').replace(/[\s"]+$/, '').replace(/""/g, '"')

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

// Cuántos separadores tiene la línea (el que más aparezca).
const separadoresDe = (linea) => Math.max((linea.match(/,/g) ?? []).length, (linea.match(/;/g) ?? []).length)
// El separador de una línea concreta.
const separadorDeLinea = (linea) => ((linea.match(/;/g) ?? []).length > (linea.match(/,/g) ?? []).length ? ';' : ',')

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
    (esNumero(barcode) || esVacio(barcode)) &&
    (RE_URL.test(video) || esVacio(video) || /^<iframe/i.test(video)) && // el video puede venir como iframe de YouTube
    (RE_URL.test(img3) || esVacio(img3)) &&
    (RE_URL.test(img2) || esVacio(img2)) &&
    (RE_URL.test(img1) || esVacio(img1))
  if (!ok) return null
  return {
    cat, sub, subSub, barcode, destacado, video,
    imagenes: [img1, img2, img3].filter((u) => RE_URL.test(u)),
  }
}

export function leerPreciosCliente(ruta) {
  const texto = readFileSync(ruta, 'utf8')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((linea) => linea.replace(/[;\s]+$/, ''))
    .join('\n')

  // 1) Filas: cada una va desde su línea de código hasta la línea que cierra la fila («;;;;;;»).
  // Las filas se agrupan por el ancla (línea de código): el terminador «;;;;;;» de cada fila también puede aparecer
  // dentro de una descripción, así que no sirve para cerrar filas.
  const filas = []
  let actual = null
  for (const linea of texto.split('\n')) {
    if (RE_INICIO.test(linea)) {
      if (actual) filas.push(actual.join('\n'))
      actual = [linea]
    } else if (actual) {
      actual.push(linea)
    }
  }
  if (actual) filas.push(actual.join('\n'))

  const productos = []
  const duplicados = []
  const raros = []
  const vistos = new Map()
  for (const fila of filas) {
    const cuerpo = fila.replace(/[;\s]+$/, '')
    const sep = separadorDeLinea(cuerpo.split('\n')[0] ?? '')
    const campos = cuerpo.split(sep)

    const cola = leerCola(campos)
    const codigo = limpiar(campos[0])
    if (!cola || !RE_CODIGO.test(codigo)) { raros.push(codigo || '(sin código)'); continue }

    // La cabeza: el nombre puede traer comas, así que se busca la corrida de once campos numéricos (precio..id
    // proveedor). El precio y el costo pueden venir vacíos; el resto tiene que ser número.
    let i = 1
    while (i + 10 < campos.length && !(esNumeroOCorto(campos[i]) && esNumeroOCorto(campos[i + 1]) && esNumero(campos[i + 2]) && esNumero(campos[i + 3]) && esNumero(campos[i + 4]) && esNumero(campos[i + 5]) && esNumero(campos[i + 6]) && esNumero(campos[i + 7]) && esNumero(campos[i + 8]) && esNumero(campos[i + 9]) && esNumero(campos[i + 10]))) i++
    const nombre = limpiar(campos.slice(1, Math.max(1, i)).join(sep))
    const num = (k) => numero(campos[i + k])

    // La descripción: entre la cabeza y la cola.
    const medio = campos.slice(i + 11, Math.max(i + 11, campos.length - 9))
    let ini = 0
    while (ini < medio.length && (esVacio(medio[ini]) || esNumero(medio[ini]))) ini++
    const descripcion = medio.slice(ini).join(sep).replace(/\s*\n\s*/g, ' ').replace(/""/g, '"').trim()

    const p = {
      codigo,
      nombre,
      precio: num(0),
      costo: num(1),
      precioX5: num(2),
      precioX10: num(3),
      precioX50: num(4),
      stockLocal: num(5),
      stockDeposito: num(6),
      idCategoria: limpiar(campos[i + 7] ?? ''),
      idSubcategoria: limpiar(campos[i + 8] ?? ''),
      idSubSubcategoria: limpiar(campos[i + 9] ?? ''),
      idProveedor: limpiar(campos[i + 10] ?? ''),
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
    separador: 'comilla',
  }
}
