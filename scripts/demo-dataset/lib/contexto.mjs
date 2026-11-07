// Carga en `ctx` lo que ya existe en la base, para correr un módulo suelto (`--solo=NN`) sobre una organización
// sembrada antes. Cada clave se llena solo si la tabla tiene filas; los módulos que crean datos los asignan ellos mismos.
import { CATEGORIAS, PRODUCTOS, PROVEEDORES } from '../datos/catalogo.mjs'
import { CUENTAS_COBRO, FORMAS_ENVIO, FORMAS_PAGO, TRANSPORTES, generarClientes } from '../datos/clientes.mjs'

export async function cargarBase(ctx) {
  const adm = await ctx.sesion('admin')
  const porClave = { 'San Javucho': 'sanjavucho', 'Mundo JC': 'mundojc' }
  for (const e of await adm.leer('empresas?select=id,nombre', 'dominio')) ctx.empresas[porClave[e.nombre]] = { id: e.id, nombre: e.nombre }

  ctx.proveedores = {}
  const provs = await adm.leer('proveedores?select=id,razon_social', 'dominio')
  for (const d of PROVEEDORES) { const f = provs.find((x) => x.razon_social === d.razon_social); if (f) ctx.proveedores[d.clave] = { id: f.id, razon_social: f.razon_social } }

  ctx.categorias = {}
  const cats = await adm.leer('categorias?select=id,nombre', 'dominio')
  for (const c of CATEGORIAS) for (const n of [c.nombre, ...c.hijas]) { const f = cats.find((x) => x.nombre === n); if (f) ctx.categorias[n] = { id: f.id, def: c } }

  ctx.productos = {}
  const prods = await adm.leer('productos?select=id,sku&limit=1000', 'dominio')
  for (const d of PRODUCTOS) { const f = prods.find((x) => x.sku === d.sku); if (f) ctx.productos[d.sku] = { id: f.id, ...d } }

  ctx.depositos = (await adm.leer('depositos?select=id,nombre,por_defecto,activo&order=creado_en', 'dominio'))

  // — Módulo 04: configuración comercial y clientes, reconstruidos por nombre contra las definiciones de datos/clientes.mjs.
  const claveEmpresa = (id) => Object.keys(ctx.empresas).find((k) => ctx.empresas[k].id === id)
  ctx.formasPago = { sanjavucho: {}, mundojc: {} }
  for (const f of await adm.leer('formas_pago?select=id,empresa_id,nombre,tipo,genera_deuda,exige_cuenta_cobro', 'dominio')) {
    const d = FORMAS_PAGO.find((x) => x.nombre === f.nombre)
    if (d && claveEmpresa(f.empresa_id)) ctx.formasPago[claveEmpresa(f.empresa_id)][d.clave] = { id: f.id, nombre: f.nombre, tipo: f.tipo, genera_deuda: f.genera_deuda, exige_cuenta_cobro: f.exige_cuenta_cobro }
  }
  ctx.formasEnvio = { sanjavucho: {}, mundojc: {} }
  for (const f of await adm.leer('formas_envio?select=id,empresa_id,nombre,tipo,exige_transporte_guia,costo_defecto', 'dominio')) {
    const d = FORMAS_ENVIO.find((x) => x.nombre === f.nombre)
    if (d && claveEmpresa(f.empresa_id)) ctx.formasEnvio[claveEmpresa(f.empresa_id)][d.clave] = { id: f.id, nombre: f.nombre, tipo: f.tipo, exige_transporte: f.exige_transporte_guia, costo: Number(f.costo_defecto) }
  }
  ctx.transportes = {}
  for (const t of await adm.leer('transportes?select=id,nombre,tipo,cobra_contrarreembolso,comision_pct', 'dominio')) {
    const d = TRANSPORTES.find((x) => x.nombre === t.nombre)
    if (d) ctx.transportes[d.clave] = { id: t.id, nombre: t.nombre, tipo: t.tipo, cobra_contrarreembolso: t.cobra_contrarreembolso, comision_pct: Number(t.comision_pct) }
  }
  ctx.cuentasCobro = {}
  for (const c of await adm.leer('cuentas_cobro?select=id,nombre,moneda', 'dominio')) {
    const d = CUENTAS_COBRO.find((x) => x.nombre === c.nombre)
    if (d) ctx.cuentasCobro[d.clave] = { id: c.id, nombre: c.nombre, moneda: c.moneda, empresas: d.empresas }
  }
  ctx.clientes = {}
  const filas = await adm.leer('clientes?select=id,numero,nombre,archivado_en,es_consumidor_final&limit=2000')
  for (const d of generarClientes(process.env.DEMO_SUFIJO ?? '')) {
    const f = filas.find((x) => x.nombre === d.nombre)
    if (f) ctx.clientes[d.clave] = { id: f.id, numero: f.numero, nombre: d.nombre, tipo: d.tipo, empresas: d.empresas, correo: d.correo, provincia: d.provincia, documento: d.documento, expreso_preferido: d.expreso_preferido, archivado: !!f.archivado_en, condicion_iva: d.condicion_iva }
  }
  // El «Consumidor final» genérico lo crea el sistema con la organización.
  const cf = filas.find((x) => x.es_consumidor_final)
  if (cf) ctx.consumidorFinal = { id: cf.id, numero: cf.numero, nombre: cf.nombre }
}
