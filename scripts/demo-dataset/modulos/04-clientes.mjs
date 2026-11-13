// Módulo 04 · Configuración comercial (formas de pago y envío, transportes, cuentas de cobro) y clientes.
import { CANTIDAD_CUENTAS_WEB, CANTIDAD_MIGRADOS, CUENTAS_COBRO, FORMAS_ENVIO, FORMAS_PAGO, SISTEMA_ANTERIOR, TRANSPORTES, generarClientes } from '../datos/clientes.mjs'
import { PASSWORD } from '../datos/base.mjs'

export const nombre = 'Clientes y configuración comercial'

export async function sembrar(ctx) {
  const { log, admin, cfg } = ctx
  const adm = await ctx.sesion('admin')
  const ids = (claves) => claves.map((c) => ctx.empresas[c].id)

  // — Formas de pago: una fila por empresa (la RPC crea una por cada id de empresa) —
  ctx.formasPago = { sanjavucho: {}, mundojc: {} }
  let orden = 0
  for (const f of FORMAS_PAGO) {
    orden += 1
    const filas = await adm.rpc('crear_forma_pago', {
      p_empresa_ids: ids(f.empresas), p_nombre: f.nombre, p_tipo: f.tipo, p_exige_cuenta_cobro: f.exige_cuenta,
      p_genera_deuda: f.deuda, p_estado_inicial: f.estado, p_orden: orden, p_activo: true,
    })
    for (const fila of filas) {
      const clave = Object.keys(ctx.empresas).find((k) => ctx.empresas[k].id === fila.empresa_id)
      ctx.formasPago[clave][f.clave] = { id: fila.id, nombre: f.nombre, tipo: f.tipo, genera_deuda: f.deuda, exige_cuenta_cobro: f.exige_cuenta }
    }
  }
  log(`${FORMAS_PAGO.length} formas de pago (${FORMAS_PAGO.reduce((s, f) => s + f.empresas.length, 0)} filas por empresa)`)

  // — Formas de envío —
  ctx.formasEnvio = { sanjavucho: {}, mundojc: {} }
  orden = 0
  for (const f of FORMAS_ENVIO) {
    orden += 1
    const filas = await adm.rpc('crear_forma_envio', {
      p_empresa_ids: ids(f.empresas), p_nombre: f.nombre, p_tipo: f.tipo, p_exige_transporte_guia: f.exige_transporte,
      p_costo_defecto: f.costo, p_estado_despacho_inicial: f.despacho, p_orden: orden, p_activo: true,
    })
    for (const fila of filas) {
      const clave = Object.keys(ctx.empresas).find((k) => ctx.empresas[k].id === fila.empresa_id)
      ctx.formasEnvio[clave][f.clave] = { id: fila.id, nombre: f.nombre, tipo: f.tipo, exige_transporte: f.exige_transporte, costo: f.costo }
    }
  }
  log(`${FORMAS_ENVIO.length} formas de envío`)

  // — Transportes —
  ctx.transportes = {}
  orden = 0
  for (const t of TRANSPORTES) {
    orden += 1
    const fila = await adm.rpc('crear_transporte', {
      p_nombre: t.nombre, p_tipo: t.tipo, p_cuit: t.cuit, p_terminal_retiro: t.terminal, p_localidad: t.localidad,
      p_telefono: t.telefono, p_correo: t.correo, p_persona_contacto: t.contacto, p_direccion: t.direccion,
      p_cobra_contrarreembolso: t.cr, p_comision_pct: t.comision, p_plazo_rendicion_dias: t.plazo, p_orden: orden,
      p_activa: true, p_empresa_ids: ids(t.empresas),
    })
    ctx.transportes[t.clave] = { id: fila.id, nombre: t.nombre, tipo: t.tipo, cobra_contrarreembolso: t.cr, comision_pct: t.comision }
  }
  log(`${TRANSPORTES.length} transportes (${TRANSPORTES.filter((t) => t.cr).length} con contrarreembolso)`)

  // — Cuentas de cobro —
  ctx.cuentasCobro = {}
  orden = 0
  for (const c of CUENTAS_COBRO) {
    orden += 1
    const fila = await adm.rpc('crear_cuenta_cobro', {
      p_nombre: c.nombre, p_titular: c.titular, p_cuit: c.cuit, p_banco: c.banco, p_alias: c.alias, p_cbu: c.cbu,
      p_tipo: c.tipo, p_moneda: c.moneda, p_orden: orden, p_activa: true, p_notas: c.notas, p_empresa_ids: ids(c.empresas),
    })
    ctx.cuentasCobro[c.clave] = { id: fila.id, nombre: c.nombre, moneda: c.moneda, empresas: c.empresas }
  }
  log(`${CUENTAS_COBRO.length} cuentas de cobro`)

  // — Clientes: alta por RLS como el operador (la sección Clientes pide «edición»); el número lo asigna la base —
  const op = await ctx.sesion('operador')
  const sufijo = process.env.DEMO_SUFIJO ?? ''
  const defs = generarClientes(sufijo)
  ctx.clientes = {}
  const cuerpo = (c) => ({
    organizacion_id: ctx.orgId, nombre: c.nombre, documento: c.documento, correo: c.correo, telefono: c.telefono,
    celular: c.celular, direccion: c.direccion, codigo_postal: c.codigo_postal, localidad: c.localidad,
    provincia: c.provincia, expreso_preferido: c.expreso_preferido, tipo: c.tipo,
  })
  for (const c of defs) {
    const [fila] = await op.insertar('clientes', cuerpo(c))
    await op.rpc('guardar_empresas_de_cliente', { p_cliente_id: fila.id, p_empresa_ids: ids(c.empresas) })
    ctx.clientes[c.clave] = { id: fila.id, numero: fila.numero, nombre: c.nombre, tipo: c.tipo, empresas: c.empresas, correo: c.correo, provincia: c.provincia, documento: c.documento, expreso_preferido: c.expreso_preferido, archivado: c.archivado, condicion_iva: c.condicion_iva }
  }
  // `condicion_iva` NO se carga: la columna no tiene permiso para `authenticated` ni RPC, y la service-role tampoco puede
  // actualizar public.clientes (falla con «permission denied for function documento_normalizado», ver informe).
  // Archivados al final: un cliente archivado ya no admite cuenta web ni vinculaciones.
  const aArchivar = defs.filter((c) => c.archivado)
  log(`${defs.length} clientes (${defs.filter((c) => c.tipo === 'mayorista').length} mayoristas)`)

  // — Identificadores externos: «migrados del sistema anterior» (solo el administrador puede vincularlos) —
  const migrables = defs.filter((c) => !c.archivado)
  let migrados = 0
  for (const c of migrables.slice(0, CANTIDAD_MIGRADOS)) {
    migrados += 1
    await adm.rpc('vincular_identificador_externo', {
      p_cliente_id: ctx.clientes[c.clave].id, p_sistema: SISTEMA_ANTERIOR, p_identificador_externo: `${sufijo ? sufijo.replace('-', '') + '-' : ''}CLI-${String(1000 + migrados * 7)}`,
    })
    ctx.clientes[c.clave].identificador_externo = true
  }
  log(`${migrados} clientes con identificador externo (${SISTEMA_ANTERIOR})`)

  // — Cuentas web —
  // Candidatos: con correo, no archivados, y al menos una tienda. Se eligen con el PRNG del contexto.
  const candidatos = ctx.azar.mezclar(defs.filter((c) => c.correo && !c.archivado)).slice(0, CANTIDAD_CUENTAS_WEB)
  let sinTienda = false
  const estados = { activa: 0, suspendida: 0, restablecimiento: 0 }
  for (const [i, c] of candidatos.entries()) {
    const cli = ctx.clientes[c.clave]
    const empresaClave = c.empresas[0]
    const empresaId = ctx.empresas[empresaClave].id
    // `preparar_cuenta_cliente` valida correo, habilitación y que la tienda tenga dominio (dominio.tiendas no se puede
    // escribir por RPC/RLS: ver informe). Si falla por eso, se sigue directo con la vinculación.
    let authId = null
    try {
      const [prep] = await op.rpc('preparar_cuenta_cliente', { p_cliente: cli.id, p_empresa: empresaId })
      authId = prep?.auth_user_id ?? null
    } catch (e) {
      if (!/no tiene dominio/.test(e.message)) throw e
      sinTienda = true
    }
    if (!authId) {
      // Auth exige correos únicos en la instancia: se limpia un usuario huérfano de una corrida anterior (el
      // `--reset` borra la organización pero no los usuarios de clientes).
      const previo = await admin.buscarUsuario(c.correo)
      if (previo) await admin.borrarUsuario(previo.id)
      authId = (await admin.crearUsuario(c.correo, PASSWORD, { nombre: c.nombre })).id
    }
    // `vincular_cuenta_cliente` solo la ejecuta la service-role (la llama la edge function invitar-cliente), así que
    // acá va con la clave de servicio; es una RPC de `public`, no toca `dominio`.
    const r = await fetch(`${cfg.url}/rest/v1/rpc/vincular_cuenta_cliente`, {
      method: 'POST',
      headers: { apikey: cfg.servicio, authorization: `Bearer ${cfg.servicio}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_cliente: cli.id, p_empresa: empresaId, p_auth_user: authId, p_actor: op.userId }),
    })
    if (!r.ok) throw new Error(`vincular_cuenta_cliente de ${c.nombre} → ${r.status}: ${await r.text()}`)
    cli.cuentaWeb = { empresa: empresaClave, estado: 'activa' }
    estados.activa += 1
    if (i % 4 === 3) {
      await op.rpc('cambiar_estado_cuenta_cliente', { p_cliente: cli.id, p_empresa: empresaId, p_estado: 'suspendida' })
      cli.cuentaWeb.estado = 'suspendida'; estados.activa -= 1; estados.suspendida += 1
    } else if (i % 4 === 1) {
      await op.rpc('registrar_restablecimiento_cuenta_cliente', { p_cliente: cli.id, p_empresa: empresaId })
      cli.cuentaWeb.restablecimiento = true; estados.restablecimiento += 1
    }
  }
  log(`${candidatos.length} cuentas web (${estados.activa} activas, ${estados.suspendida} bloqueadas, ${estados.restablecimiento} con restablecimiento de clave)${sinTienda ? ' · sin dominio de tienda: se saltó preparar_cuenta_cliente' : ''}`)

  // — Archivados —
  for (const c of aArchivar) {
    await op.actualizar(`clientes?id=eq.${ctx.clientes[c.clave].id}`, { archivado_en: new Date().toISOString() })
  }
  log(`${aArchivar.length} clientes archivados`)
}
