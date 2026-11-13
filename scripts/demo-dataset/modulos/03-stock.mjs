// Módulo 03 · Stock y compras: depósitos, stock inicial, ingresos de mercadería (con anulados), movimientos,
// toma de inventario, traslados, reservas de productos «A pedido» y mínimos.
//
// Todo se escribe como usuario real por las RPC (el esquema `dominio` no da permisos a la service-role key).
// Quién hace qué: Administrador crea depósitos, actualiza costos (exige `rentabilidad` en edición) y migra el archivo;
// Depósito registra ingresos, movimientos, traslados y tomas; Operador reserva (tiene Stock en edición).
import { PROVEEDORES } from '../datos/catalogo.mjs'
import { diaHabilHaceDias } from '../lib/fechas.mjs'
import {
  A_CERO, BAJO_MINIMO, CON_EXCESO, DEPOSITOS, MOTIVOS_ANULACION, NOTAS_DEVOLUCION, NOTAS_DEVOLUCION_PROVEEDOR,
  NOTAS_ROTURA, OPERADORES_ANTERIORES, PEDIDO, PESO_PROVEEDORES, PRINCIPAL, RANGOS, RANGOS_COMPRA, SIN_CARGA, comprobante,
} from '../datos/stock.mjs'

export const nombre = 'Stock y compras'

const raiz = (ctx, p) => ctx.categorias[p.categoria].def.nombre
const rango = (tabla, ctx, p) => tabla[raiz(ctx, p)] ?? tabla.default

export async function sembrar(ctx) {
  const { log, azar } = ctx
  const adm = await ctx.sesion('admin')
  const dep = await ctx.sesion('deposito')
  const ope = await ctx.sesion('operador')
  const skus = Object.keys(ctx.productos)
  const sku = (id) => skus.find((k) => ctx.productos[k].id === id)

  // El mismo módulo dos veces sobre la misma base chocaría con los nombres únicos: mejor un mensaje claro.
  const previos = await adm.leer('depositos?select=id,nombre,por_defecto,activo&order=creado_en', 'dominio')
  if (previos.length > 1) throw new Error('El módulo 03 ya corrió sobre esta organización. Corré con --reset para recrearla.')

  // UUID determinista (sale del azar con semilla): sirve de clave de idempotencia sin romper la reproducibilidad.
  const uuid = () => {
    const h = Array.from({ length: 32 }, () => azar.entero(0, 15).toString(16))
    h[12] = '4'; h[16] = '89ab'[azar.entero(0, 3)]
    return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20).join('')}`
  }
  // Un rechazo que la base DEBE dar: si la RPC lo acepta, se avisa (es un hallazgo), pero no se corta la siembra.
  const rechazo = async (descripcion, patron, fn) => {
    try { await fn() } catch (e) {
      if (patron.test(e.message)) return log(`rechazo esperado OK · ${descripcion}`)
      return log(`ATENCIÓN · ${descripcion}: falló con otro mensaje → ${e.message}`)
    }
    log(`ATENCIÓN · ${descripcion}: la base NO lo rechazó`)
  }
  // Existencias por producto y depósito, leídas de nuevo cuando hace falta (los movimientos las cambian).
  const leerStock = async () => {
    const filas = await adm.leer('existencias_deposito?select=producto_id,deposito_id,cantidad,reservado&limit=5000', 'dominio')
    const m = {}
    for (const f of filas) (m[sku(f.producto_id)] ??= {})[f.deposito_id] = { cant: f.cantidad, res: f.reservado }
    return m
  }
  const total = (m, k) => Object.values(m[k] ?? {}).reduce((s, x) => s + x.cant, 0)
  const motivos = Object.fromEntries((await adm.leer('motivos_movimiento?select=id,nombre', 'dominio')).map((x) => [x.nombre, x.id]))
  for (const n of ['Compra a proveedor', 'Rotura o pérdida', 'Conteo de inventario', 'Devolución']) if (!motivos[n]) throw new Error(`Falta el motivo «${n}»`)

  // — Depósitos —
  const principal = previos.find((d) => d.por_defecto)
  const ids = (claves) => claves.map((c) => ctx.empresas[c].id)
  await adm.rpc('actualizar_deposito', { p_deposito: principal.id, p_nombre: principal.nombre, p_direccion: PRINCIPAL.direccion, p_empresas: ids(PRINCIPAL.ventas) })
  const D = { principal: principal.id }
  for (const d of DEPOSITOS) {
    const fila = await adm.rpc('crear_deposito', { p_nombre: d.nombre, p_direccion: d.direccion, p_empresas: ids(d.ventas) })
    D[d.clave] = fila.id
  }
  await adm.rpc('cambiar_activo_deposito', { p_deposito: D.barracas, p_activo: false })
  log(`depósitos: principal + ${DEPOSITOS.map((d) => d.nombre).join(', ')} (el último inactivo)`)
  await rechazo('desactivar el depósito por defecto', /por defecto no se puede desactivar/i, () => adm.rpc('cambiar_activo_deposito', { p_deposito: D.principal, p_activo: false }))
  await rechazo('nombre de depósito repetido', /Ya existe un depósito/i, () => adm.rpc('crear_deposito', { p_nombre: 'local corrientes', p_direccion: null, p_empresas: [] }))
  await rechazo('crear depósito sin ser administrador', /Solo el Administrador/i, () => dep.rpc('crear_deposito', { p_nombre: 'Intruso', p_direccion: null, p_empresas: [] }))

  // — Stock inicial: una carga inicial por producto, en el depósito donde «vive» —
  // Lo que venden las dos tiendas está sobre todo en el principal; lo exclusivo de Mundo JC, en Córdoba.
  const base = {}
  const dondeVive = {}
  for (const k of skus) {
    if (SIN_CARGA.includes(k)) continue
    const p = ctx.productos[k]
    const emp = ctx.categorias[p.categoria].def.empresas
    const d = emp.length === 1 && emp[0] === 'mundojc' ? 'cordoba'
      : emp.length === 1 ? azar.ponderado([['principal', 7], ['local', 3]])
        : azar.ponderado([['principal', 6], ['local', 2], ['cordoba', 2]])
    const [mn, mx] = rango(RANGOS, ctx, p)
    base[k] = azar.entero(mn, mx)
    dondeVive[k] = d
  }
  for (const d of ['principal', 'local', 'cordoba']) {
    const filas = Object.keys(base).filter((k) => dondeVive[k] === d).map((k) => ({ sku: k, cantidad: base[k], motivo: 'Stock inicial al implantar el sistema' }))
    const previa = await dep.rpc('validar_carga_stock', { p_deposito: D[d], p_filas: filas })
    const malas = previa.filter((f) => !['ajuste', 'nuevo', 'ok'].includes(f.estado))
    if (malas.length) log(`ATENCIÓN · vista previa de carga (${d}): ${malas.length} filas no válidas, p. ej. ${malas[0].sku}: ${malas[0].mensaje}`)
    const r = await dep.rpc('aplicar_carga_inicial_stock', { p_deposito: D[d], p_filas: filas, p_clave: uuid() })
    log(`carga inicial en ${d}: ${filas.length} productos (${JSON.stringify(r).slice(0, 90)})`)
  }

  // — Un remito completo por «Carga en lote» (proveedor como texto libre, sin pasar por Compras) —
  const lotes = [
    { dias: 52, prov: 'Distribuidora Gamer Norte S.R.L.', skus: ['JOY-DS4-NG', 'JOY-DS4-ROJO', 'JOY-XBOX-BL', 'JOY-PROCON-NSW', 'CAB-HDMI21-2M'] },
    { dias: 21, prov: 'TecnoParts Argentina S.R.L.', skus: ['REP-DS4-BOT', 'REP-DS4-BAT', 'REP-JOYCON-BAT', 'REP-PS4-VENT'] },
  ]
  for (const l of lotes) {
    const lineas = l.skus.map((k) => ({ producto: ctx.productos[k].id, cantidad: azar.entero(8, 30) }))
    const r = await dep.rpc('registrar_lote_stock', { p_lineas: lineas, p_motivo: motivos['Compra a proveedor'], p_proveedor: l.prov, p_fecha: diaHabilHaceDias(l.dias), p_clave: uuid() })
    log(`lote de stock Nº ${r.lote.numero}: ${lineas.length} productos de ${l.prov}`)
  }

  // — Ingresos de mercadería: 25 en 88 días, de todos los proveedores, con comprobante y varias líneas —
  const provDef = Object.fromEntries(PROVEEDORES.map((p) => [p.clave, p]))
  const excluidos = new Set([...SIN_CARGA, ...A_CERO, ...BAJO_MINIMO, ...CON_EXCESO])
  const nIngresos = 25
  ctx.ingresos = []
  const numeroPorPunto = {}
  const fijoPedido = 9 // este ingreso trae las unidades del PS5 Pro (a pedido): las reservas las necesitan
  for (let i = 0; i < nIngresos; i++) {
    const provClave = i === fijoPedido ? 'norte' : azar.ponderado(PESO_PROVEEDORES)
    const pool = skus.filter((k) => ctx.productos[k].prov === provClave && !excluidos.has(k))
    const elegidos = azar.mezclar(pool).slice(0, azar.entero(2, Math.min(6, pool.length)))
    if (i === fijoPedido) elegidos.unshift(PEDIDO.sku)
    const lineas = elegidos.map((k) => {
      const p = ctx.productos[k]
      const [mn, mx] = k === PEDIDO.sku ? [PEDIDO.unidades, PEDIDO.unidades] : rango(RANGOS_COMPRA, ctx, p)
      return { sku: k, producto_id: p.id, cantidad: azar.entero(mn, mx), costo_unitario_usd: Math.round(p.costo * (0.96 + azar.siguiente() * 0.08) * 100) / 100 }
    })
    const punto = azar.entero(1, 6)
    numeroPorPunto[punto] = (numeroPorPunto[punto] ?? azar.entero(100, 9000)) + azar.entero(1, 40)
    const sinComprobante = i === 3 || i === 17 // el comprobante es opcional
    const actualizarCosto = i % 4 === 2 // 6 de 25 actualizan el costo (exige permiso de Rentabilidad: Administrador)
    const fecha = diaHabilHaceDias(Math.max(1, Math.round(88 - i * 3.5 + azar.entero(-1, 1))))
    const args = {
      p_empresa: ctx.empresas[azar.elegir(provDef[provClave].empresas)].id, p_proveedor: ctx.proveedores[provClave].id, p_fecha: fecha,
      p_comprobante: sinComprobante ? null : comprobante(punto, numeroPorPunto[punto]),
      p_lineas: lineas.map(({ producto_id, cantidad, costo_unitario_usd }) => ({ producto_id, cantidad, costo_unitario_usd })),
      p_actualizar_costo: actualizarCosto, p_clave_idempotencia: uuid(),
    }
    const fila = await (actualizarCosto ? adm : dep).rpc('registrar_ingreso_mercaderia', args)
    ctx.ingresos.push({ id: fila.id, fecha, proveedor: provClave, comprobante: args.p_comprobante, costo_actualizado: actualizarCosto, estado: 'registrado', fijo: i === fijoPedido, lineas: lineas.map(({ sku: s, cantidad, costo_unitario_usd }) => ({ sku: s, cantidad, costo: costo_unitario_usd })) })
    if (i === 5) { // reintento con la misma clave: no debe duplicar ni mover stock otra vez
      const otra = await dep.rpc('registrar_ingreso_mercaderia', args)
      log(otra.id === fila.id ? 'idempotencia OK · mismo ingreso con la misma clave' : 'ATENCIÓN · la misma clave de idempotencia creó otro ingreso')
    }
  }
  log(`${nIngresos} ingresos de mercadería (${ctx.ingresos.filter((x) => x.costo_actualizado).length} con costo actualizado)`)
  await rechazo('ingreso con fecha futura', /futura/i, () => dep.rpc('registrar_ingreso_mercaderia', {
    p_empresa: ctx.empresas.sanjavucho.id, p_proveedor: ctx.proveedores.norte.id, p_fecha: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
    p_comprobante: null, p_lineas: [{ producto_id: ctx.productos['JOY-DS4-NG'].id, cantidad: 1, costo_unitario_usd: 28 }], p_actualizar_costo: false, p_clave_idempotencia: uuid(),
  }))

  // — Anulados: 3 ingresos viejos (revierte el stock con una salida por línea) —
  let anulados = 0
  for (const ing of ctx.ingresos.filter((x) => !x.fijo && !x.costo_actualizado).slice(2)) {
    if (anulados === 3) break
    if (anulados === 0 && !ing.comprobante) continue
    try {
      await dep.rpc('anular_ingreso_mercaderia', { p_ingreso: ing.id, p_motivo: MOTIVOS_ANULACION[anulados] })
      ing.estado = 'anulado'; anulados += 1
    } catch (e) { log(`no se pudo anular ${ing.id}: ${e.message}`) }
  }
  log(`${anulados} ingresos anulados`)
  const anul = ctx.ingresos.find((x) => x.estado === 'anulado')
  if (anul) await rechazo('anular un ingreso ya anulado', /anulado/i, () => dep.rpc('anular_ingreso_mercaderia', { p_ingreso: anul.id, p_motivo: 'Segundo intento' }))

  // — Archivo del panel anterior: historial de solo consulta (no mueve stock) —
  const filasArchivo = Array.from({ length: 40 }, (_, i) => {
    const k = azar.elegir(skus)
    return {
      fila: i + 1, id_externo: `LEG-${String(1000 + i * 7)}`, fecha: diaHabilHaceDias(azar.entero(100, 700)), producto: ctx.productos[k].nombre,
      cantidad: String(azar.entero(2, 40)), proveedor: provDef[ctx.productos[k].prov].razon_social, operador: azar.elegir(OPERADORES_ANTERIORES),
    }
  })
  const carga = await adm.rpc('iniciar_carga_migracion', { p_entidad: 'ingresos_archivo', p_archivo: 'ingresos-anteriores.csv', p_filas_total: filasArchivo.length })
  const prev = await adm.rpc('previsualizar_lote_archivo_ingresos', { p_filas: filasArchivo })
  log(`vista previa del archivo: ${JSON.stringify(prev).slice(0, 100)}`)
  await adm.rpc('aplicar_lote_archivo_ingresos', { p_carga: carga, p_lote: 1, p_filas: filasArchivo.slice(0, 25) })
  await adm.rpc('aplicar_lote_archivo_ingresos', { p_carga: carga, p_lote: 2, p_filas: filasArchivo.slice(25) })
  await adm.rpc('cerrar_carga_migracion', { p_carga: carga })
  log(`archivo de ingresos anteriores: ${filasArchivo.length} filas en 2 lotes`)

  // — Movimientos sueltos: roturas, conteos, devoluciones y compras directas a otros depósitos —
  let stock = await leerStock()
  const candidatos = () => skus.filter((k) => !SIN_CARGA.includes(k) && !A_CERO.includes(k) && !BAJO_MINIMO.includes(k) && total(stock, k) >= 12)
  const mayorDeposito = (k) => Object.entries(stock[k]).sort((a, b) => b[1].cant - a[1].cant)[0]
  const mov = async (k, tipo, cantidad, motivo, nota, dias, deposito) => dep.rpc('registrar_movimiento_stock', {
    p_producto: ctx.productos[k].id, p_tipo: tipo, p_cantidad: cantidad, p_motivo: motivos[motivo], p_nota: nota, p_fecha: diaHabilHaceDias(dias), p_deposito: deposito,
  })
  let nMov = 0
  for (const k of azar.mezclar(candidatos()).slice(0, 10)) { // roturas y pérdidas
    const [d] = mayorDeposito(k)
    await mov(k, 'salida', azar.entero(1, 3), 'Rotura o pérdida', azar.elegir(NOTAS_ROTURA), azar.entero(3, 70), d); nMov++
  }
  stock = await leerStock()
  for (const k of azar.mezclar(candidatos()).slice(0, 6)) { // conteo: el contado difiere en pocas unidades
    const [d, x] = mayorDeposito(k)
    await mov(k, 'ajuste', Math.max(0, x.cant + azar.elegir([-4, -3, -2, -1, 1, 2, 3])), 'Conteo de inventario', 'Diferencia hallada en el conteo mensual', azar.entero(2, 45), d); nMov++
  }
  for (const k of azar.mezclar(candidatos()).slice(0, 6)) { // devoluciones de clientes: vuelven al stock
    const [d] = mayorDeposito(k)
    await mov(k, 'entrada', azar.entero(1, 2), 'Devolución', azar.elegir(NOTAS_DEVOLUCION), azar.entero(1, 40), d); nMov++
  }
  for (const k of azar.mezclar(candidatos()).slice(0, 3)) { // devoluciones al proveedor: salen
    const [d] = mayorDeposito(k)
    await mov(k, 'salida', azar.entero(2, 4), 'Devolución', azar.elegir(NOTAS_DEVOLUCION_PROVEEDOR), azar.entero(5, 50), d); nMov++
  }
  for (const k of azar.mezclar(candidatos().filter((x) => x !== PEDIDO.sku)).slice(0, 4)) { // compras directas al local y a Córdoba
    await mov(k, 'entrada', azar.entero(6, 20), 'Compra a proveedor', 'Compra directa para el local, sin pasar por el depósito', azar.entero(2, 30), azar.elegir([D.local, D.cordoba])); nMov++
  }
  log(`${nMov} movimientos sueltos (roturas, conteos, devoluciones, compras directas)`)
  const k0 = candidatos()[0]
  await rechazo('salida mayor al stock (no hay negativos)', /No hay stock suficiente/i, () => mov(k0, 'salida', 99999, 'Rotura o pérdida', 'Prueba de stock negativo', 1, D.principal))
  await rechazo('movimiento en un depósito inactivo', /inactivo/i, () => mov(k0, 'entrada', 1, 'Compra a proveedor', 'Prueba de depósito inactivo', 1, D.barracas))
  await rechazo('desactivar un depósito con stock', /Tiene stock/i, () => adm.rpc('cambiar_activo_deposito', { p_deposito: D.local, p_activo: false }))

  // — Toma de inventario: se cuenta toda la categoría Joysticks en el depósito por defecto —
  stock = await leerStock()
  const items = skus.filter((k) => ctx.productos[k].categoria === 'Joysticks').map((k, i) => {
    const actual = stock[k]?.[D.principal]?.cant ?? 0
    return { producto: ctx.productos[k].id, contado: i % 3 === 0 || actual === 0 ? actual : Math.max(0, actual + azar.elegir([-3, -2, -1, 1, 2])) }
  })
  const toma = await dep.rpc('confirmar_toma_inventario', { p_items: items, p_fecha: diaHabilHaceDias(4) })
  const repetida = await dep.rpc('confirmar_toma_inventario', { p_items: items, p_fecha: diaHabilHaceDias(4) })
  log(`toma de inventario de Joysticks: ${items.length} contados, ${toma.length} ajustes (repetirla crea ${repetida.length})`)

  // — Traslados entre depósitos: ~12, incluidos reposiciones de vuelta y uno local → Córdoba —
  stock = await leerStock()
  const trasl = async (k, o, d, n, nota, dias) => dep.rpc('trasladar_stock', { p_producto: ctx.productos[k].id, p_origen: o, p_destino: d, p_cantidad: n, p_nota: nota, p_fecha: diaHabilHaceDias(dias) })
  const vendeEn = (k) => ctx.categorias[ctx.productos[k].categoria].def.empresas
  let nTras = 0
  const enPrincipal = azar.mezclar(candidatos().filter((k) => (stock[k]?.[D.principal]?.cant ?? 0) >= 12 && k !== PEDIDO.sku))
  for (const k of enPrincipal.slice(0, 9)) {
    const destino = vendeEn(k).includes('sanjavucho') && (!vendeEn(k).includes('mundojc') || azar.probabilidad(0.6)) ? D.local : D.cordoba
    const n = azar.entero(2, Math.min(6, Math.floor(stock[k][D.principal].cant / 2)))
    await trasl(k, D.principal, destino, n, destino === D.local ? 'Reposición del local de Corrientes' : 'Reposición para Mundo JC Córdoba', azar.entero(2, 40)); nTras++
  }
  await trasl(PEDIDO.sku, D.principal, D.local, 2, 'Unidades del PS5 Pro para entregas en el local', 12); nTras++
  const enOtros = Object.keys(stock).filter((k) => [D.local, D.cordoba].some((d) => (stock[k][d]?.cant ?? 0) >= 8) && !SIN_CARGA.includes(k) && !A_CERO.includes(k))
  for (const k of azar.mezclar(enOtros).slice(0, 2)) { // devolución de mercadería al depósito central
    const d = [D.local, D.cordoba].find((x) => (stock[k][x]?.cant ?? 0) >= 8)
    await trasl(k, d, D.principal, azar.entero(2, 4), 'Vuelve al depósito central: exceso en el local', azar.entero(1, 15)); nTras++
  }
  log(`${nTras} traslados entre depósitos`)
  await rechazo('traslado mayor al disponible', /No hay stock suficiente/i, () => trasl(k0, D.principal, D.local, 99999, 'Prueba', 1))
  await rechazo('traslado con origen = destino', /distintos/i, () => trasl(k0, D.principal, D.principal, 1, 'Prueba', 1))

  // — Reservas del producto «A pedido» (solo aplican a él): activas, descontadas (entregadas) y liberadas —
  const ped = ctx.productos[PEDIDO.sku].id
  const reservar = (d, n, ref) => ope.rpc('reservar_stock', { p_producto: ped, p_deposito: d, p_cantidad: n, p_referencia: ref })
  ctx.reservas = []
  const plan = [
    [D.principal, 1, 'PEDIDO-0001 · seña recibida, retira la semana próxima', 'activa'],
    [D.principal, 2, 'PEDIDO-0002 · cliente mayorista', 'descontada'],
    [D.principal, 1, 'PEDIDO-0003 · el cliente canceló', 'liberada'],
    [D.local, 1, 'PEDIDO-0004 · retira en el local de Corrientes', 'activa'],
    [D.principal, 1, 'PEDIDO-0005 · entregada por envío', 'descontada'],
    [D.principal, 1, 'PEDIDO-0006 · se cayó la venta', 'liberada'],
  ]
  for (const [d, n, ref, fin] of plan) {
    let r = await reservar(d, n, ref)
    if (fin === 'descontada') r = await ope.rpc('descontar_reserva', { p_reserva: r.id })
    if (fin === 'liberada') r = await ope.rpc('liberar_reserva', { p_reserva: r.id })
    ctx.reservas.push({ id: r.id, referencia: ref, estado: r.estado, cantidad: n, deposito_id: d })
  }
  log(`${plan.length} reservas del PS5 Pro (2 activas, 2 descontadas, 2 liberadas)`)
  const primera = ctx.reservas[0]
  const igual = await reservar(primera.deposito_id, primera.cantidad, plan[0][2])
  log(igual.id === primera.id ? 'idempotencia OK · misma referencia devuelve la misma reserva' : 'ATENCIÓN · la misma referencia creó otra reserva')
  await rechazo('misma referencia con otros datos', /otros datos/i, () => reservar(D.principal, 3, plan[0][2]))
  await rechazo('reservar un producto que no es A pedido', /A pedido/i, () => ope.rpc('reservar_stock', { p_producto: ctx.productos['JOY-DS4-NG'].id, p_deposito: D.principal, p_cantidad: 1, p_referencia: 'PRUEBA-NO-PEDIDO' }))
  await rechazo('reservar más que el disponible', /No hay stock suficiente/i, () => reservar(D.principal, 999, 'PRUEBA-EXCESO'))
  await rechazo('liberar una reserva ya liberada', /ya fue liberada/i, () => ope.rpc('liberar_reserva', { p_reserva: ctx.reservas[2].id }))

  // — Productos «en cero»: un conteo los deja sin unidades (se agotaron) —
  stock = await leerStock()
  for (const k of A_CERO) {
    for (const [d, x] of Object.entries(stock[k] ?? {})) if (x.cant > 0) await mov(k, 'ajuste', 0, 'Conteo de inventario', 'Se agotó: el conteo no encontró unidades', azar.entero(1, 10), d)
  }

  // — Mínimos: la mayoría con colchón razonable; algunos por encima de lo que hay (bajo mínimo), otros con exceso —
  stock = await leerStock()
  let bajos = 0, excesos = 0, enCero = 0
  for (const k of skus) {
    const t = total(stock, k)
    let minimo
    if (BAJO_MINIMO.includes(k)) { minimo = t + azar.entero(0, 4); bajos++ }
    else if (CON_EXCESO.includes(k)) { minimo = 2; excesos++ }
    else if (A_CERO.includes(k) || SIN_CARGA.includes(k)) { minimo = azar.entero(3, 8); enCero += t === 0 ? 1 : 0 }
    else minimo = Math.max(1, Math.round(t * (0.15 + azar.siguiente() * 0.15)))
    if (SIN_CARGA.includes(k) && ['CON-XBS-X', 'NOV-PS5-PORTAL'].includes(k)) minimo = 3
    await dep.rpc('definir_minimo_stock', { p_producto: ctx.productos[k].id, p_minimo: minimo })
  }
  log(`mínimos definidos en ${skus.length} productos (${bajos} bajo mínimo forzado, ${excesos} con exceso, ${enCero} en cero con mínimo)`)

  // — Lo que necesitan los módulos siguientes —
  ctx.depositos = (await adm.leer('depositos?select=id,nombre,por_defecto,activo&order=creado_en', 'dominio'))
  const estados = await adm.leer('stock_estados?select=estado&limit=1000')
  const cuenta = estados.reduce((a, x) => ({ ...a, [x.estado]: (a[x.estado] ?? 0) + 1 }), {})
  log(`estado del stock: ${JSON.stringify(cuenta)}`)
}
