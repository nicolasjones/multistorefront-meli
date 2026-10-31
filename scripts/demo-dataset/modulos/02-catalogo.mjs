// Módulo 02 · Proveedores, categorías, catálogo (~100 productos), escalas, IVA, reglas por empresa y dólar.
import { CATEGORIAS, PRODUCTOS, PROVEEDORES } from '../datos/catalogo.mjs'
import { ean13 } from '../lib/ean.mjs'

export const nombre = 'Proveedores, catálogo y precios'

export async function sembrar(ctx) {
  const { log } = ctx
  const adm = await ctx.sesion('admin')
  const idsEmpresas = (claves) => claves.map((c) => ctx.empresas[c].id)

  // — Proveedores —
  ctx.proveedores = {}
  for (const p of PROVEEDORES) {
    const fila = await adm.rpc('crear_proveedor', {
      p_razon_social: p.razon_social, p_cuit: p.cuit, p_persona_contacto: p.contacto, p_correo: p.correo,
      p_telefono: p.telefono, p_direccion: p.direccion,
    })
    await adm.rpc('guardar_empresas_de_proveedor', { p_proveedor_id: fila.id, p_empresa_ids: idsEmpresas(p.empresas) })
    ctx.proveedores[p.clave] = { id: fila.id, razon_social: p.razon_social }
  }
  log(`${PROVEEDORES.length} proveedores`)

  // — Categorías (raíz + hijas) con su alícuota de IVA —
  const alicuotas = Object.fromEntries((await adm.leer('alicuotas_iva?select=id,nombre', 'dominio')).map((a) => [a.nombre, a.id]))
  ctx.categorias = {}
  for (const c of CATEGORIAS) {
    const empresaIds = idsEmpresas(c.empresas)
    const raiz = await adm.rpc('guardar_categoria', { p_id: null, p_nombre: c.nombre, p_padre_id: null, p_empresa_ids: empresaIds })
    ctx.categorias[c.nombre] = { id: raiz, def: c }
    if (!alicuotas[c.iva]) throw new Error(`No existe la alícuota "${c.iva}" (hay: ${Object.keys(alicuotas).join(', ')})`)
    await adm.rpc('guardar_alicuota_categoria', { p_categoria: raiz, p_alicuota: alicuotas[c.iva] })
    for (const h of c.hijas) {
      const id = await adm.rpc('guardar_categoria', { p_id: null, p_nombre: h, p_padre_id: raiz, p_empresa_ids: empresaIds })
      ctx.categorias[h] = { id, def: c }
    }
  }
  log(`${Object.keys(ctx.categorias).length} categorías`)

  // — Cotización inicial del dólar: sin esto los productos en USD no tienen precio en pesos —
  await adm.rpc('fijar_cotizacion_inicial', { p_valor: 1180 })

  // — Productos —
  ctx.productos = {}
  let n = 0
  for (const p of PRODUCTOS) {
    n += 1
    const cat = ctx.categorias[p.categoria]
    const prov = ctx.proveedores[p.prov]
    const fila = await adm.rpc('crear_producto', {
      p_nombre: p.nombre, p_descripcion: p.descripcion, p_sku: p.sku, p_compatible_con: p.compat, p_moneda: 'USD',
      p_precio_lista: p.lista, p_costo: p.costo, p_proveedor_id: prov.id, p_codigo_proveedor: `${p.prov.toUpperCase()}-${p.sku}`,
      p_codigo_barras: ean13(1000 + n), p_disponibilidad_manual: p.ped ?? null,
    })
    await adm.rpc('asignar_categoria_producto', { p_producto_id: fila.id, p_categoria_id: cat.id })
    await adm.rpc('definir_empresas_producto', { p_producto_id: fila.id, p_empresa_ids: idsEmpresas(cat.def.empresas) })
    const es = cat.def.escalas
    if (es && p.lista >= 5) {
      const r = (v) => Math.round(p.lista * v * 100) / 100
      await adm.rpc('guardar_precios_escala', { p_producto: fila.id, p_x5: r(es[0]), p_x10: r(es[1]), p_x50: r(es[2]) })
    }
    ctx.productos[p.sku] = { id: fila.id, ...p }
  }
  log(`${PRODUCTOS.length} productos con proveedor, categoría, empresas, código de barras y escalas`)

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
