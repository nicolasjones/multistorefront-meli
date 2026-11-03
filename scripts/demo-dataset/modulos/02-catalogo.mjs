// Módulo 02 · Proveedores, categorías, catálogo, escalas, IVA, reglas por empresa y dólar.
//
// El catálogo es el del cliente (el CSV de precios que exporta su panel) cuando se pasa `DEMO_CSV_CLIENTE`; si no,
// el catálogo ficticio de `datos/catalogo.mjs` (el de siempre, con ~100 productos inventados).
import { CATEGORIAS, PRODUCTOS, PROVEEDORES } from '../datos/catalogo.mjs'
import { catalogoReal } from '../datos/catalogo-real.mjs'
import { ean13 } from '../lib/ean.mjs'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

export const nombre = 'Proveedores, catálogo y precios'

// Sube las fotos al bucket de la tienda (la base firma las URLs contra ese bucket). La ruta es la que exige la
// tabla `dominio.producto_imagenes`: <organización>/<producto>/<posición>-<hash>.<ext>.
async function subirImagenes(ctx, bucket, imagenes) {
  const { url, servicio } = ctx.cfg
  let subidas = 0
  const cola = [...imagenes]
  const workers = Array.from({ length: 8 }, async () => {
    while (cola.length) {
      const i = cola.shift()
      if (!existsSync(i.archivo)) continue
      try {
        const datos = await readFile(i.archivo)
        const r = await fetch(`${url}/storage/v1/object/${bucket}/${i.ruta}`, {
          method: 'POST',
          headers: { apikey: servicio, authorization: `Bearer ${servicio}`, 'content-type': 'image/jpeg', 'x-upsert': 'true' },
          body: datos,
        })
        if (r.ok) subidas++
      } catch {
        // Si una foto no se puede subir, el producto queda sin ella (no frena la carga).
      }
    }
  })
  await Promise.all(workers)
  return subidas
}

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
    log(`datos REALES del cliente: ${real.resumen.total} productos, precios en pesos, stock, ${real.resumen.raices} categorías raíz y fotos (el resto del demo es simulado)`)
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
  // Las fotos del cliente ya están bajadas (`bajar-imagenes.mjs` deja el mapeo y los archivos): se suben al bucket
  // con la ruta que exige la base (<organización>/<producto>/archivo) y se arma el archivo con los INSERT, que el
  // shell pipea al psql (el cliente puede estar en otro contenedor y no ver el sistema de archivos del host).
  const mapeo = process.env.DEMO_IMAGENES_JSON ?? '/tmp/demo-imagenes.json'
  const carpeta = process.env.DEMO_IMAGENES_CARPETA ?? '/tmp/imgs'
  const bucket = process.env.DEMO_IMAGENES_BUCKET ?? 'productos-imagenes'
  const archivoSql = process.env.DEMO_IMAGENES_SQL ?? '/tmp/demo-imagenes.sql'
  if (existsSync(mapeo)) {
    try {
      const desdeArchivos = JSON.parse(readFileSync(mapeo, 'utf8'))
      const imagenes = []
      for (const [sku, lista] of Object.entries(desdeArchivos)) {
        const p = ctx.productos[sku]
        if (!p) continue
        for (const item of lista.sort((a, b) => a.posicion - b.posicion)) {
          const ruta = `${ctx.orgId}/${p.id}/${item.posicion}-${item.hash}.${item.ext}`
          imagenes.push({ sku, posicion: item.posicion, ruta, archivo: `${carpeta}/${item.archivo}` })
        }
      }
      const subidas = await subirImagenes(ctx, bucket, imagenes)
      log(`${subidas} de ${imagenes.length} fotos subidas al bucket «${bucket}»`)
      const sentencia = (i) => `insert into dominio.producto_imagenes (producto_id, organizacion_id, posicion, ruta)\n` +
        `select p.id, p.organizacion_id, ${i.posicion}, '${i.ruta.replace(/'/g, "''")}'\n` +
        `  from dominio.productos p\n where p.organizacion_id = '${ctx.orgId}' and p.sku = '${i.sku.replace(/'/g, "''")}'\n` +
        `on conflict do nothing;`
      writeFileSync(archivoSql, [
        '-- Imágenes de los productos (lo genera el módulo 02; lo pipea el shell al psql).',
        ...imagenes.map(sentencia),
      ].join('\n') + '\n')
      ctx.archivoImagenes = archivoSql
      log(`${imagenes.length} imágenes para el paso SQL (${archivoSql})`)
    } catch (e) {
      log(`ATENCIÓN · no se pudieron subir las imágenes: ${e.message}`)
    }
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
