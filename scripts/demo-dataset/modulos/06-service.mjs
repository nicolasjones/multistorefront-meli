// Módulo 06 · Service técnico: modelos de equipo, estados propios y reparaciones en todos los estados.
//
// Quién hace qué (según la matriz real de permisos de la organización):
//   · admin    configura modelos y estados, y es el único que carga costos internos (`ver_costos`).
//   · operador recibe los equipos, registra entregas y anula (tiene edición en Service y acceso a ambas tiendas).
//   · tecnico  figura como responsable de cada reparación (no puede operar: ver nota en `sembrar`).
// El operador hace el trabajo de mostrador y de taller. El rol «mostrador» solo tiene lectura en Service.
//
// El alta fija el ingreso en «hoy»: para repartir las reparaciones en 90 días se retoca `ingreso_en` con
// `actualizar_reparacion` (único parámetro de fecha que ofrece la API). Las fechas del historial de estados y de
// `creado_en` son now() y las ajusta el paso SQL de fechas (99), no este módulo.
import { MODELOS, MODELOS_DE_FABRICA, ESTADOS_PROPIOS, REPARACIONES, RETIRA } from '../datos/service.mjs'
import { fechaHaceDias } from '../lib/fechas.mjs'

export const nombre = 'Service técnico'

const redondear = (n) => Math.round(n * 100) / 100

// Llama a una RPC y, si falla, agrega a qué reparación/paso correspondía (los errores de la API no lo dicen).
async function rpc(s, nombreRpc, args, donde) {
  try { return await s.rpc(nombreRpc, args) } catch (e) { e.message = `[${donde}] ${e.message}`; throw e }
}
// Verifica un caso borde: la operación DEBE ser rechazada por la base.
async function debeFallar(log, titulo, promesa, fragmento) {
  try { await promesa } catch (e) {
    if (fragmento && !e.message.includes(fragmento)) throw new Error(`Caso «${titulo}»: falló con otro mensaje: ${e.message}`)
    log(`✓ rechazado como corresponde · ${titulo}: ${e.message.replace(/^.*→ \d+: /, '')}`)
    return
  }
  throw new Error(`Caso «${titulo}»: la base lo aceptó y debía rechazarlo`)
}

export async function sembrar(ctx) {
  const { log, azar } = ctx
  const adm = await ctx.sesion('admin')
  const op = await ctx.sesion('operador')

  // Ojo: el usuario «tecnico» NO puede operar. Es un rol de organización (la base prohíbe asignarle tiendas en
  // `usuarios_empresas`) pero `private.empresas_accesibles()` solo deja pasar a administradores o a quienes tengan
  // tienda asignada, así que toda RPC de Service le responde «No tenés acceso a esa tienda». Mientras eso no se
  // corrija, el trabajo del taller lo hace el operador (edición en Service y en ambas tiendas) y el técnico queda
  // solo como responsable (`tecnico_id`) de cada reparación.
  const tecnicoId = (await ctx.sesion('tecnico')).userId
  const tec = op

  // — Modelos de equipo —
  const existentes = await adm.leer('modelos_equipo?select=id,equipo,modelo,activo,updated_at', 'dominio')
  const modelos = {}
  let nuevos = 0
  for (const [clave, equipo, modelo, base] of MODELOS) {
    const ya = existentes.find((m) => m.equipo === equipo && m.modelo === modelo)
    if (ya) {
      // Los de fábrica vienen en ARS: se pasan a USD con la mano de obra base de este dataset.
      let fila = await adm.rpc('actualizar_modelo_equipo', { p_id: ya.id, p_actualizado_en: ya.updated_at, p_equipo: equipo, p_modelo: modelo, p_mano_obra_base: base })
      if (!ya.activo) fila = await adm.rpc('cambiar_estado_modelo_equipo', { p_id: ya.id, p_activo: true })
      modelos[clave] = { id: fila.id, base }
    } else {
      const fila = await adm.rpc('crear_modelo_equipo', { p_equipo: equipo, p_modelo: modelo, p_mano_obra_base: base })
      modelos[clave] = { id: fila.id, base }
      nuevos += 1
    }
  }
  log(`${MODELOS.length} modelos de equipo (${nuevos} nuevos, ${MODELOS_DE_FABRICA.size} de fábrica pasados a USD)`)

  // — Estados propios, ubicados donde corresponden en el flujo, y uno desactivado —
  for (const e of ESTADOS_PROPIOS) {
    const fila = await adm.rpc('crear_estado_reparacion', { p_nombre: e.nombre, p_descripcion: e.descripcion, p_avisa_cliente: e.avisa })
    for (let i = 0; i < e.subir; i++) await adm.rpc('mover_estado_reparacion', { p_id: fila.id, p_direccion: 'subir' })
    if (e.desactivar) await adm.rpc('cambiar_estado_estado_reparacion', { p_id: fila.id, p_activo: false })
  }
  const estados = {}
  for (const s of await adm.leer('estados_reparacion?select=id,nombre,activo,cierra,avisa_cliente,orden&order=orden', 'dominio')) estados[s.nombre] = s
  log(`${Object.keys(estados).length} estados (${ESTADOS_PROPIOS.length} propios, 1 desactivado): ${Object.values(estados).map((s) => s.nombre).join(' → ')}`)

  // — Reparaciones, de la más antigua a la más nueva para que la numeración siga el calendario —
  const clavePorEmpresa = { sj: 'sanjavucho', jc: 'mundojc' }
  const todos = Object.values(ctx.clientes).filter((c) => !c.archivado)
  const reparaciones = {}
  const conteo = {}
  let vencidas = 0, items = 0
  const orden = [...REPARACIONES].sort((a, b) => b.dias - a.dias)

  for (const r of orden) {
    const empresa = ctx.empresas[clavePorEmpresa[r.emp]]
    const modelo = modelos[r.modelo]
    if (!modelo) throw new Error(`Modelo desconocido: ${r.modelo}`)
    const donde = `${r.clave} ${r.modelo}`

    let cliente
    if (r.cliente === 'cf') cliente = ctx.consumidorFinal
    else if (r.mismoCliente) cliente = reparaciones[r.mismoCliente].cliente
    else {
      const pool = todos.filter((c) => c.tipo === 'minorista' && c.empresas.includes(clavePorEmpresa[r.emp]))
      cliente = azar.elegir(pool.length ? pool : todos)
    }
    const telefono = r.cliente === 'cf' ? 'Sin teléfono (mostrador)' : r.emp === 'sj' ? `+54 9 11 5555-${azar.entero(1000, 9999)}` : `+54 9 351 555-${azar.entero(1000, 9999)}`
    const falla = r.falla.replace(/\{r:(\w+)\}/g, (_, k) => reparaciones[k].json.codigo)

    const recibe = op
    const alta = await rpc(recibe, 'crear_reparacion', {
      p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_contacto: telefono,
      p_numero_serie: r.serie ?? null, p_accesorios: r.acc, p_falla: falla,
    }, donde)

    // Costos internos (solo admin): mano de obra a ~45 % de lo cobrado y repuestos a su costo de catálogo.
    const cobraMO = (r.ruta.length >= 2 && r.fin !== 'anulada') || r.fin === 'sin_reparacion'
    const precioMO = r.mo ?? modelo.base
    const costoMO = cobraMO && r.mo !== 0 ? redondear(precioMO * 0.45) : 0
    let costoRep = 0
    for (const it of r.items) {
      if (it[0] === 'libre') costoRep += it[3] * it[2] * 0.7
      else costoRep += (ctx.productos[it[0]]?.costo ?? 0) * it[1]
    }
    const entregaPrevista = r.prom == null ? null : fechaHaceDias(r.dias - r.prom)
    const editada = await rpc(adm, 'actualizar_reparacion', {
      p_id: alta.id, p_actualizado_en: alta.updated_at, p_cliente_id: cliente.id, p_modelo_id: modelo.id,
      p_contacto: telefono, p_numero_serie: r.serie ?? null, p_accesorios: r.acc, p_falla: falla,
      p_costo_mano_obra: costoMO, p_costo_repuestos: redondear(costoRep), p_tecnico_id: tecnicoId,
      p_ingreso_en: fechaHaceDias(r.dias), p_entrega_prevista: entregaPrevista,
    }, donde)
    reparaciones[r.clave] = { json: editada, cliente, def: r }

    // Recorrido de estados hasta el último no cerrado.
    for (const e of r.ruta) await rpc(tec, 'cambiar_estado_reparacion', { p_id: alta.id, p_estado_id: estados[e].id }, `${donde} → ${e}`)

    // Ítems (mano de obra y repuestos); no se pueden cargar una vez cerrada o anulada.
    const cargar = (args) => rpc(tec, 'agregar_item_reparacion', { p_producto_id: null, ...args, p_reparacion_id: alta.id }, `${donde} ítem`).then(() => { items += 1 })
    if (cobraMO && r.mo !== 0) {
      await cargar({ p_tipo: 'mano_obra', p_descripcion: r.fin === 'sin_reparacion' ? 'Diagnóstico del equipo' : r.mo != null ? 'Mano de obra especializada (soldadura / microelectrónica)' : 'Mano de obra: reparación estándar', p_cantidad: 1, p_precio: precioMO })
    }
    if (r.mo === 0 && r.items.length) await cargar({ p_tipo: 'mano_obra', p_descripcion: 'Mano de obra por garantía (sin cargo)', p_cantidad: 1, p_precio: 0 })
    for (const it of r.items) {
      if (it[0] === 'libre') await cargar({ p_tipo: 'repuesto', p_descripcion: it[1], p_cantidad: it[2], p_precio: it[3] })
      else {
        const p = ctx.productos[it[0]]
        // Repuesto de garantía: se cobra en 0 (lo absorbe la tienda), igual descuenta/registra como cualquier otro.
        await cargar({ p_tipo: 'repuesto', p_descripcion: '', p_producto_id: p.id, p_cantidad: it[1], p_precio: r.mo === 0 ? 0 : (it[2] ?? p.lista) })
      }
    }

    // Cierre.
    let estadoFinal = r.ruta.at(-1) ?? 'Recibido'
    if (r.fin === 'entregada' || r.fin === 'sin_reparacion') {
      estadoFinal = r.fin === 'entregada' ? 'Entregado' : 'Sin reparación'
      const dias = Math.min(r.entrega, r.dias)
      const quien = r.fin === 'sin_reparacion' ? 'El titular (retira el equipo sin reparar)' : azar.elegir(RETIRA)
      await rpc(op, 'registrar_entrega_reparacion', { p_id: alta.id, p_estado_id: estados[estadoFinal].id, p_entrega_real: fechaHaceDias(r.dias - dias), p_entregado_por: quien }, donde)
    } else if (r.fin === 'anulada') {
      await rpc(op, 'anular_reparacion', { p_id: alta.id, p_motivo: r.motivo }, donde)
      estadoFinal = `${estadoFinal} (anulada)`
    } else if (entregaPrevista && entregaPrevista < fechaHaceDias(0) && estadoFinal !== 'Listo para entregar') vencidas += 1
    conteo[estadoFinal] = (conteo[estadoFinal] ?? 0) + 1
  }
  log(`${REPARACIONES.length} reparaciones, ${items} ítems, ${vencidas} vencidas sin entregar`)
  log(`por estado: ${Object.entries(conteo).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

  // — Casos borde que la base tiene que rechazar (si alguno se acepta, el módulo falla) —
  const abierta = reparaciones.r31.json.id, entregada = reparaciones.r01.json.id, anulada = reparaciones.r12.json.id
  await debeFallar(log, 'cerrar con cambio de estado (debe ir por entrega)', tec.rpc('cambiar_estado_reparacion', { p_id: abierta, p_estado_id: estados['Entregado'].id }), 'registrá la entrega')
  await debeFallar(log, 'cambiar estado de una entregada', tec.rpc('cambiar_estado_reparacion', { p_id: entregada, p_estado_id: estados['En diagnóstico'].id }), 'entregada o cerrada')
  await debeFallar(log, 'cambiar estado de una anulada', tec.rpc('cambiar_estado_reparacion', { p_id: anulada, p_estado_id: estados['En diagnóstico'].id }), 'anulada')
  await debeFallar(log, 'pasar a un estado desactivado', tec.rpc('cambiar_estado_reparacion', { p_id: abierta, p_estado_id: estados['Derivado a proveedor'].id }), 'desactivado')
  await debeFallar(log, 'anular sin motivo', op.rpc('anular_reparacion', { p_id: abierta, p_motivo: '  ' }), 'motivo')
  await debeFallar(log, 'entrega con fecha futura', op.rpc('registrar_entrega_reparacion', { p_id: abierta, p_estado_id: estados['Entregado'].id, p_entrega_real: fechaHaceDias(-3), p_entregado_por: 'El titular' }), 'futura')
  await debeFallar(log, 'entrega sin decir quién retira', op.rpc('registrar_entrega_reparacion', { p_id: abierta, p_estado_id: estados['Entregado'].id, p_entrega_real: fechaHaceDias(0), p_entregado_por: '' }), 'quién')
  await debeFallar(log, 'agregar un ítem a una reparación entregada', tec.rpc('agregar_item_reparacion', { p_reparacion_id: entregada, p_tipo: 'repuesto', p_descripcion: 'Repuesto fuera de plazo', p_producto_id: null, p_cantidad: 1, p_precio: 5 }))
  await debeFallar(log, 'crear reparación con un rol de solo lectura (mostrador)', (await ctx.sesion('mostrador')).rpc('crear_reparacion', { p_empresa_id: ctx.empresas.sanjavucho.id, p_cliente_id: reparaciones.r31.cliente.id, p_modelo_id: modelos.ps5.id }), 'rol')

  ctx.reparaciones = reparaciones
}
