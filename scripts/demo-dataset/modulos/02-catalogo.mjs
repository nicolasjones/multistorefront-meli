// Módulo 02 · Proveedores, categorías, catálogo, escalas, IVA, reglas por empresa y dólar.
//
// El catálogo es el del cliente (el CSV de precios que exporta su panel) cuando se pasa `DEMO_CSV_CLIENTE`; si no,
// el catálogo ficticio de `datos/catalogo.mjs` (el de siempre, con ~100 productos inventados).
import { CATEGORIAS, PRODUCTOS, PROVEEDORES } from '../datos/catalogo.mjs'
import { catalogoReal } from '../datos/catalogo-real.mjs'
import { ean13 } from '../lib/ean.mjs'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

export const nombre = 'Proveedores, catálogo y precios'

export async function sembrar(ctx) {
  const { log } = ctx
  const adm = await ctx.sesion('admin')
  const idsEmpresas = (claves) => claves.map((c) => ctx.empresas[c].id)

  // — Catálogo: el real del cliente si viene el CSV; si no, el ficticio —
  const csv = process.env.DEMO_CSV_CLIENTE
  const real = csv ? catalogoReal(csv) : null
  const proveedores = real ? real.proveedores : PROVEEDORES
  const categorias = real ? real.categorias : CATEGORIAS
  const productos = real ? real.productos : PRODUCTOS
  ctx.catalogoReal = Boolean(real)
  if (real) {
    log(`catálogo real del cliente: ${real.resumen.total} productos (${real.resumen.raices} categorías raíz, separador «${real.resumen.separador}»)`)
    if (real.resumen.duplicados.length) log(`códigos repetidos (se queda el primero): ${real.resumen.duplicados.join(', ')}`)
    if (real.resumen.sinPrecio.length) log(`sin precio (quedan en 0): ${real.resumen.sinPrecio.join(', ')}`)
  }

  // — Proveedores —
  ctx.proveedores = {}
  for (const p of proveedores) {
    const fila = await adm.rpc('crear_proveedor', {
      p_razon_social: p.razon_social, p_cuit: p.cuit, p_persona_contacto: p.contacto, p_correo: p.correo,
      p_telefono: p.telefono, p_direccion: p.direccion,
    })
    await adm.rpc('guardar_empresas_de_proveedor', { p_proveedor_id: fila.id, p_empresa_ids: idsEmpresas(p.empresas) })
    ctx.proveedores[p.clave] = { id: fila.id, razon_social: p.razon_social, empresas: p.empresas }
  }
  log(`${proveedores.length} proveedores`)

  // — Categorías (hasta tres niveles) con su alícuota de IVA —
  const alicuotas = Object.fromEntries((await adm.leer('alicuotas_iva?select=id,nombre', 'dominio')).map((a) => [a.nombre, a.id]))
  ctx.categorias = {}
  for (const c of categorias) {
    const empresaIds = idsEmpresas(c.empresas)
    const raiz = await adm.rpc('guardar_categoria', { p_id: null, p_nombre: c.nombre, p_padre_id: null, p_empresa_ids: empresaIds })
    // La clave es la ruta completa (en el catálogo real hay nombres repetidos entre ramas: PS3, GAMER, XBOX…).
    ctx.categorias[c.ruta ?? c.nombre] = { id: raiz, def: c }
    if (!alicuotas[c.iva]) throw new Error(`No existe la alícuota "${c.iva}" (hay: ${Object.keys(alicuotas).join(', ')})`)
    await adm.rpc('guardar_alicuota_categoria', { p_categoria: raiz, p_alicuota: alicuotas[c.iva] })
    // Las hijas del árbol: el catálogo ficticio tiene dos niveles y el del cliente tres.
    const crearHijas = async (hijas, padreId) => {
      for (const h of hijas) {
        // El catálogo ficticio usa strings y el del cliente objetos con nombre y ruta.
        const nombreHija = typeof h === 'string' ? h : h.nombre
        const rutaHija = typeof h === 'string' ? h : (h.ruta ?? h.nombre)
        const id = await adm.rpc('guardar_categoria', { p_id: null, p_nombre: nombreHija, p_padre_id: padreId, p_empresa_ids: empresaIds })
        ctx.categorias[rutaHija] = { id, def: c }
        if (h.hijas?.length) await crearHijas(h.hijas, id)
      }
    }
    await crearHijas(c.hijas ?? [], raiz)
  }
  log(`${Object.keys(ctx.categorias).length} categorías`)

  // — Cotización inicial del dólar: sin esto los productos en USD no tienen precio en pesos —
  await adm.rpc('fijar_cotizacion_inicial', { p_valor: 1180 })

  // — Productos —
  ctx.productos = {}
  let n = 0
  for (const p of productos) {
    n += 1
    const cat = ctx.categorias[p.categoria]
    const prov = ctx.proveedores[p.prov]
    const fila = await adm.rpc('crear_producto', {
      p_nombre: p.nombre, p_descripcion: p.descripcion, p_sku: p.sku, p_compatible_con: p.compat, p_moneda: p.moneda ?? 'USD',
      p_precio_lista: p.lista, p_costo: p.costo, p_proveedor_id: prov.id, p_codigo_proveedor: `${p.prov.toUpperCase()}-${p.sku}`,
      p_codigo_barras: p.codigoBarras || ean13(1000 + n), p_disponibilidad_manual: p.ped ?? null,
    })
    await adm.rpc('asignar_categoria_producto', { p_producto_id: fila.id, p_categoria_id: cat.id })
    await adm.rpc('definir_empresas_producto', { p_producto_id: fila.id, p_empresa_ids: idsEmpresas(cat.def.empresas) })
    // Escalas: el CSV trae el precio de cada escala; si no, se calculan con el descuento de la categoría.
    const es = cat.def.escalas
    const escala = [p.precioX5, p.precioX10, p.precioX50]
    const tieneEscala = escala.some((v) => v > 0)
    if (tieneEscala) {
      const r = (v, f) => Math.round((v > 0 ? v : p.lista * f) * 100) / 100
      await adm.rpc('guardar_precios_escala', { p_producto: fila.id, p_x5: r(escala[0], es?.[0] ?? 1), p_x10: r(escala[1], es?.[1] ?? 1), p_x50: r(escala[2], es?.[2] ?? 1) })
    } else if (es && p.lista >= 5) {
      const r = (v) => Math.round(p.lista * v * 100) / 100
      await adm.rpc('guardar_precios_escala', { p_producto: fila.id, p_x5: r(es[0]), p_x10: r(es[1]), p_x50: r(es[2]) })
    }
    ctx.productos[p.sku] = { id: fila.id, ...p }
  }
  log(`${productos.length} productos con proveedor, categoría, empresas, código de barras y escalas`)

  // — Imágenes: la tabla `dominio.producto_imagenes` no tiene RPC de escritura, así que el paso SQL las carga. —
  // Si el paso de descarga de fotos del cliente ya dejó el mapeo (JSON con las rutas ya subidas al bucket), se usa ese:
  // la tienda firma las URLs del bucket, no las del panel del cliente.
  const destino = process.env.DEMO_IMAGENES_CSV ?? '/tmp/demo-imagenes.csv'
  const mapeo = process.env.DEMO_IMAGENES_JSON ?? destino.replace(/\.csv$/, '.json')
  if (existsSync(mapeo)) {
    try {
      const desdeBucket = JSON.parse(readFileSync(mapeo, 'utf8'))
      let n = 0
      for (const [sku, lista] of Object.entries(desdeBucket)) {
        const p = ctx.productos[sku]
        if (!p) continue
        p.imagenes = lista.sort((a, b) => a.posicion - b.posicion).map((x) => x.ruta)
        n += p.imagenes.length
      }
      log(`${n} imágenes tomadas del bucket (${mapeo})`)
    } catch (e) {
      log(`ATENCIÓN · no se pudo leer ${mapeo}: ${e.message}`)
    }
  }

  // El archivo con los INSERT: el shell lo pipea al psql (el cliente puede estar en otro contenedor y no ver el
  // sistema de archivos del host, así que no puede leer un CSV con \copy).
  const archivoSql = process.env.DEMO_IMAGENES_SQL ?? '/tmp/demo-imagenes.sql'
  const imagenes = []
  for (const p of Object.values(ctx.productos)) {
    for (const [i, ruta] of (p.imagenes ?? []).entries()) imagenes.push({ sku: p.sku, posicion: i + 1, ruta })
  }
  if (imagenes.length) {
    const org = ctx.orgId
    const sentencia = (i) => `insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta)\n` +
      `select p.id, p.organizacion_id, ${i.posicion}, '${i.ruta.replace(/'/g, "''")}'\n` +
      `  from dominio.productos p\n where p.organizacion_id = '${org}' and p.sku = '${i.sku.replace(/'/g, "''")}'\n` +
      `on conflict do nothing;`
    writeFileSync(archivoSql, [
      '-- Imágenes de los productos (lo genera el módulo 02; lo pipea el shell al psql).',
      ...imagenes.map(sentencia),
    ].join('\n') + '\n')
    ctx.archivoImagenes = archivoSql
    log(`${imagenes.length} imágenes para el paso SQL (${archivoSql})`)
  }

  // — Reglas de precio por empresa: San Javucho (minorista) = precio central con IVA; Mundo JC = +8 % sin IVA —
  await adm.rpc('guardar_regla_precio_empresa', { p_empresa: ctx.empresas.sanjavucho.id, p_base: 'central', p_ajuste_pct: 0, p_updated_at: null, p_mostrar_con_iva: true })
  await adm.rpc('guardar_regla_precio_empresa', { p_empresa: ctx.empresas.mundojc.id, p_base: 'central_ajuste', p_ajuste_pct: 8, p_updated_at: null, p_mostrar_con_iva: false })
  log('reglas de precio por empresa (San Javucho 0 % con IVA · Mundo JC +8 % sin IVA)')

  // — Evolución del dólar: cargas semanales. `cargar_cotizacion` deja la cotización pendiente (con vista previa) y
  // `confirmar_cotizacion` la registra y recalcula los precios en pesos de los productos en USD. —
  const serie = [1195, 1210, 1208, 1235, 1262, 1259, 1290, 1318, 1350, 1347, 1385, 1420]
  let recalculados = 0
  for (const valor of serie) {
    await adm.rpc('cargar_cotizacion', { p_valor: valor })
    const r = await adm.rpc('confirmar_cotizacion')
    recalculados += Number(r?.precios_recalculados ?? 0)
  }
  log(`${serie.length} cotizaciones confirmadas (dólar de 1180 a ${serie.at(-1)}; ${recalculados} precios recalculados)`)
}
