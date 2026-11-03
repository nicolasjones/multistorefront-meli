// Catálogo real de San Javucho: arma la misma estructura que `datos/catalogo.mjs` (ficticio) pero con el CSV de precios
// que exporta su panel.
//
// Las diferencias con el catálogo ficticio, que obligan a tratar los datos aparte:
//   · Son más de 2.000 productos y el árbol de categorías tiene TRES niveles (categoría / subcategoría / sub subcategoría),
//     mientras el ficticio tiene dos.
//   · Los precios vienen en pesos (el panel no vende en dólares): los productos se crean con `moneda = 'ARS'` para que
//     la tienda muestre exactamente el número del CSV, sin depender de la cotización del dólar.
//   · Cada producto trae sus fotos (URLs del panel), su código de barras, su stock real en dos depósitos y su
//     marca de «destacado».
//
// Lo que NO trae el CSV (y queda inventado, como en el catálogo ficticio): el CUIT de los proveedores, la alícuota de
// IVA de cada categoría, los descuentos por escala (si el CSV no trae precio x5/x10/x50 se calcula por la categoría) y
// el texto de las categorías.

import { leerPreciosCliente } from '../lib/csvCliente.mjs'
import { cuitValido } from '../lib/cuit.mjs'

// IVA por defecto (el CSV no lo trae): 21 %; los productos «en outlet» del panel suelen ir al 10,5 %.
const IVA_DEFAULT = '21 %'
const IVA_OUTLET = '10,5 %'

// Descuentos por escala (x5/x10/x50) cuando el CSV no los trae: los mismos del catálogo ficticio.
const ESCALAS_DEFAULT = [0.95, 0.91, 0.86]

const normalizar = (s) => (s ?? '').trim()

// El CSV escribe las categorías en mayúsculas y sus subcategorías con nombres propios (SONY, NINTENDO, PS3…).
// El árbol del demo se arma con esos nombres literales (para que la tienda muestre la misma organización).
export function catalogoReal(ruta) {
  const leido = leerPreciosCliente(ruta)
  const productos = leido.productos

  // — Árbol de categorías (hasta tres niveles) —
  const raices = new Map()
  for (const p of productos) {
    const cat = normalizar(p.categoria)
    if (!cat) continue
    if (!raices.has(cat)) raices.set(cat, new Map())
    const sub = normalizar(p.subcategoria)
    if (!sub) continue
    if (!raices.get(cat).has(sub)) raices.get(cat).set(sub, new Set())
    const subSub = normalizar(p.subSubcategoria)
    if (subSub && subSub !== '0') raices.get(cat).get(sub).add(subSub)
  }
  const categorias = []
  for (const [nombreCat, subs] of [...raices.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hijas = []
    for (const [nombreSub, subSubs] of [...subs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      hijas.push({
        nombre: nombreSub,
        ruta: `${nombreCat} > ${nombreSub}`,
        hijas: [...subSubs].sort().map((n) => ({ nombre: n, ruta: `${nombreCat} > ${nombreSub} > ${n}`, hijas: [] })),
      })
    }
    categorias.push({
      nombre: nombreCat,
      ruta: nombreCat,
      empresas: ['sanjavucho', 'mundojc'],
      iva: /OUTLET/i.test(nombreCat) ? IVA_OUTLET : IVA_DEFAULT,
      escalas: ESCALAS_DEFAULT,
      hijas,
    })
  }

  // — Proveedores: el CSV solo trae un id numérico; se crea uno por id con un CUIT inventado —
  const proveedores = []
  const claveProveedor = new Map()
  for (const id of leido.proveedores) {
    const clave = `prov-${id}`
    claveProveedor.set(id, clave)
    proveedores.push({
      clave,
      razon_social: `Proveedor ${id}`,
      cuit: cuitValido('30', 60_000_000 + Number(id) * 137),
      contacto: 'Proveedor',
      correo: `ventas@${clave}.demo`,
      telefono: '+54 11 5555-0000',
      direccion: 'Dirección del proveedor',
      empresas: ['sanjavucho', 'mundojc'],
    })
  }

  // — Productos —
  const lista = []
  for (const p of productos) {
    const categoria = [normalizar(p.categoria), normalizar(p.subcategoria), normalizar(p.subSubcategoria)]
      .filter((c) => c && c !== '0')
    if (!categoria.length) continue
    // La ruta completa es la clave: hay nombres de categoría repetidos en ramas distintas (PS3, GAMER, XBOX…).
    const ruta = categoria.join(' > ')
    const prov = claveProveedor.get(p.idProveedor) ?? proveedores[0]?.clave
    if (!prov) continue
    // Sin precio no hay producto: la base exige un precio de lista mayor a cero.
    if (!p.precio || p.precio <= 0) continue
    lista.push({
      sku: p.codigo,
      nombre: p.nombre,
      descripcion: p.descripcion || p.nombre,
      compat: [],
      lista: p.precio ?? 0, // pesos: el producto se crea con moneda ARS
      costo: p.costo ?? 0,
      categoria: ruta, // hoja del árbol (ruta completa: los nombres se repiten entre ramas)
      rutaCategoria: categoria,
      prov,
      imagenes: p.imagenes,
      destacado: p.destacado,
      // El código de barras tiene que ser EAN-13: si el CSV trae otro formato se deja vacío y el módulo
      // genera uno (los productos sin código de barras del cliente no se inventan).
      codigoBarras: /^\d{13}$/.test(p.codigoBarras ?? '') ? p.codigoBarras : null,
      stockLocal: p.stockLocal ?? 0,
      stockDeposito: p.stockDeposito ?? 0,
      precioX5: p.precioX5 ?? 0,
      precioX10: p.precioX10 ?? 0,
      precioX50: p.precioX50 ?? 0,
      video: p.video || null,
      moneda: 'ARS',
    })
  }

  return {
    proveedores,
    categorias,
    productos: lista,
    resumen: {
      total: productos.length,
      duplicados: leido.duplicados,
      raros: leido.raros,
      conStock: leido.conStock,
      sinPrecio: leido.sinPrecio,
      separador: leido.separador,
      raices: categorias.length,
    },
  }
}
