// Módulo 05 · Ventas, cobros, despacho y RMA: presupuestos, facturas, cobros (totales, parciales, deuda), armado y
// entrega con responsables, faltantes de despacho, envíos con transporte y guía, anulaciones, notas de crédito y devoluciones.
//
// Todo se escribe como usuario real por las RPC (el esquema `dominio` no da permisos a la service-role key).
// Quién hace qué (lo decide la matriz de roles de la base): Mostrador (solo San Javucho), Operador y Administración
// venden y confirman; Operador además edita precios; Mostrador y Administración cobran; Depósito arma, controla y entrega
// (el que controla tiene que ser otro que el que armó, salvo el Administrador); Administración anula y emite notas de
// crédito; el Administrador reingresa stock de devoluciones.
//
// Regla de la base que ordena todo: una factura que pasa a Cobrado o Deuda deja de estar «confirmada» y el despacho
// ya no la acepta (ver el informe), así que se despacha ANTES de cobrar. Las señas en efectivo no cambian el estado.
//
// Lo que la API no permite y queda en `sql/91-ventas-contrarreembolsos-impresiones.sql`: abrir contrarreembolsos
// (`private.abrir_contrarreembolso` no tiene RPC pública), cobrarlos a través de la RPC con la sesión de Administración
// y dejar documentos e impresiones (los PDF los genera un worker externo que acá no existe).
import { CASOS_FACTURA, CASOS_PRESUPUESTO, CONCEPTOS_NC, FRACCION_VENDIBLE, MOTIVOS_ANULACION_VENTA, MOTIVOS_RMA, NOTAS_CREDITO, OBSERVACIONES_RMA, PESO_RUBRO_MAYORISTA, PESO_RUBRO_MINORISTA, PREFIJO_GUIA, PRESUPUESTOS_COPIADOS, RMA_PLAN, CANALES_ENVIO, CANALES_RETIRO } from '../datos/ventas.mjs'
import { A_CERO, BAJO_MINIMO, PEDIDO, SIN_CARGA } from '../datos/stock.mjs'
import { fechaHaceDias, haceDias, iso } from '../lib/fechas.mjs'

export const nombre = 'Ventas, cobros, despacho y RMA'

const DIA = 86_400_000
const sumarDias = (f, n) => iso(new Date(new Date(`${f}T12:00:00Z`).getTime() + n * DIA))
const cents = (n) => Math.round(Number(n) * 100)
const plata = (c) => Number((c / 100).toFixed(2))

export async function sembrar(ctx) {
  const { log, azar } = ctx
  const adm = await ctx.sesion('admin')
  const S = { admin: adm, operador: await ctx.sesion('operador'), mostrador: await ctx.sesion('mostrador'), deposito: await ctx.sesion('deposito'), administracion: await ctx.sesion('administracion') }
  const dep = S.deposito
  const previos = await adm.leer('comprobantes_venta?select=id&limit=1', 'dominio')
  if (previos.length) throw new Error('El módulo 05 ya corrió sobre esta organización. Corré con --reset para recrearla.')

  // Un rechazo que la base DEBE dar: si la RPC lo acepta, se avisa (es un hallazgo), pero no se corta la siembra.
  const rechazo = async (descripcion, patron, fn) => {
    try { await fn() } catch (e) {
      if (patron.test(e.message)) return log(`rechazo esperado OK · ${descripcion}`)
      return log(`ATENCIÓN · ${descripcion}: falló con otro mensaje → ${e.message}`)
    }
    log(`ATENCIÓN · ${descripcion}: la base NO lo rechazó`)
  }

  // ───────────── Catálogo de venta: productos por empresa, depósitos por empresa y presupuesto de stock ─────────────
  const raizDe = (p) => ctx.categorias[p.categoria].def.nombre
  const vendeEn = (p) => ctx.categorias[p.categoria].def.empresas
  const excluidos = new Set([...SIN_CARGA, ...A_CERO, ...BAJO_MINIMO, PEDIDO.sku])
  const catalogo = Object.values(ctx.productos).filter((p) => !excluidos.has(p.sku))
  const skuDe = new Map(Object.values(ctx.productos).map((p) => [p.id, p.sku]))
  const depsEmpresa = { sanjavucho: [], mundojc: [] }
  for (const r of await adm.leer('depositos_empresas?select=deposito_id,empresa_id&limit=100', 'dominio')) {
    const clave = Object.keys(ctx.empresas).find((k) => ctx.empresas[k].id === r.empresa_id)
    const d = ctx.depositos.find((x) => x.id === r.deposito_id)
    if (clave && d?.activo) depsEmpresa[clave].push(d.id)
  }
  const depPorNombre = (n) => ctx.depositos.find((d) => d.nombre === n)?.id
  const disp = new Map() // `${sku}|${deposito}` → unidades que todavía se pueden vender en la siembra
  for (const f of await adm.leer('existencias_deposito?select=producto_id,deposito_id,cantidad,reservado&limit=5000', 'dominio')) {
    const sku = skuDe.get(f.producto_id)
    if (!sku || excluidos.has(sku)) continue
    const frac = FRACCION_VENDIBLE[raizDe(ctx.productos[sku])] ?? FRACCION_VENDIBLE.default
    disp.set(`${sku}|${f.deposito_id}`, Math.floor(Math.max(0, f.cantidad - f.reservado) * frac))
  }
  const presupuesto = (sku, d) => disp.get(`${sku}|${d}`) ?? 0

  // ───────────── Fechas: tendencia creciente, picos de fin de mes, sin domingos ─────────────
  const pesoDia = (d) => {
    const f = haceDias(d), dow = f.getUTCDay()
    if (dow === 0) return 0
    const ultimo = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate()
    const finDeMes = f.getUTCDate() >= ultimo - 2 || f.getUTCDate() <= 1 ? 2.4 : 1
    return (0.6 + (1.4 * (90 - d)) / 90) * finDeMes * (dow === 6 ? 0.7 : 1)
  }
  const dia = (min, max) => azar.ponderado(Array.from({ length: max - min + 1 }, (_, i) => [min + i, pesoDia(min + i)]))

  // ───────────── Clientes ─────────────
  const todos = Object.values(ctx.clientes).filter((c) => !c.archivado)
  const mayoristas = todos.filter((c) => c.tipo === 'mayorista')
  // Los deudores son siempre los mismos cuatro mayoristas: así la cartera de deuda se ve concentrada.
  const deudores = mayoristas.filter((c) => c.empresas.length === 2).sort((a, b) => a.numero - b.numero).slice(0, 4)
  const clienteDe = (emp, tipo) => {
    if (tipo === 'minorista' && ctx.consumidorFinal && azar.probabilidad(0.15)) return { ...ctx.consumidorFinal, tipo: 'minorista', empresas: ['sanjavucho', 'mundojc'], expreso_preferido: null }
    let pool = todos.filter((c) => c.tipo === tipo && c.empresas.includes(emp))
    if (!pool.length) pool = todos.filter((c) => c.tipo === tipo)
    // Los primeros cinco del listado repiten más: hay clientes frecuentes y una cola larga de ocasionales.
    return azar.ponderado(pool.map((c, i) => [c, i < 5 ? 4 : 1]))
  }

  // ───────────── Carrito: productos con stock disponible en un depósito de la empresa ─────────────
  function armarLineas(emp, tipo, nMax) {
    const pesos = tipo === 'mayorista' ? PESO_RUBRO_MAYORISTA : PESO_RUBRO_MINORISTA
    const pool = catalogo.filter((p) => vendeEn(p).includes(emp) && pesos[raizDe(p)])
    const lineas = []
    const n = azar.entero(1, nMax)
    for (let intento = 0; intento < 60 && lineas.length < n; intento++) {
      const rubro = azar.ponderado(Object.entries(pesos))
      const delRubro = pool.filter((p) => raizDe(p) === rubro && !lineas.some((l) => l.sku === p.sku))
      if (!delRubro.length) continue
      const p = azar.elegir(delRubro)
      let cantidad
      if (tipo === 'mayorista') {
        const [mn, mx] = azar.ponderado([[[5, 9], 3], [[10, 49], 5], [[50, 60], 2]])
        cantidad = azar.entero(mn, mx)
      } else cantidad = raizDe(p) === 'Consolas de juegos' || p.lista > 15 ? 1 : azar.ponderado([[1, 6], [2, 3], [3, 1]])
      // Mejor depósito: el que más presupuesto tenga (el principal desempata a favor).
      const deps = depsEmpresa[emp].map((d) => [d, presupuesto(p.sku, d)]).sort((a, b) => b[1] - a[1])
      const [d, hay] = deps[0]
      if (tipo === 'mayorista') { if (hay < 5) continue; cantidad = Math.min(cantidad, hay) } else if (hay < cantidad) continue
      disp.set(`${p.sku}|${d}`, hay - cantidad)
      lineas.push({ sku: p.sku, cantidad, dep: d })
    }
    return lineas
  }

  // ───────────── Formas de envío, transportes y guías ─────────────
  const expresos = { sanjavucho: ['cuyano', 'patagonia', 'litoral', 'nortenio', 'noreste'], mundojc: ['cuyano', 'patagonia', 'nortenio', 'noreste'] }
  const conCR = { sanjavucho: ['cuyano', 'patagonia', 'litoral', 'noreste'], mundojc: ['cuyano', 'patagonia', 'noreste'] }
  const transporteDe = (emp, envio, cliente, soloCR) => {
    if (envio === 'correo') return 'plata'
    if (envio === 'moto_cba') return 'moto_jc'
    if (envio === 'expreso' || envio === 'terminal') {
      const pref = Object.entries(ctx.transportes).find(([, t]) => t.nombre === cliente?.expreso_preferido)?.[0]
      const lista = soloCR ? conCR[emp] : expresos[emp]
      return pref && lista.includes(pref) ? pref : azar.elegir(lista)
    }
    return null
  }
  const decidirEnvio = (emp, tipo, canal, { cr = false, sinListo = false } = {}) => {
    if (cr) return azar.ponderado([['correo', 3], ['expreso', 4], ['terminal', 2]])
    if (tipo === 'mayorista') {
      const retiro = emp === 'mundojc' && !sinListo ? 'retiro_mayorista' : 'retiro'
      return azar.ponderado([['expreso', 5], ['correo', 1], [retiro, 3], ['terminal', 1]])
    }
    if (canal === 'mostrador') return azar.ponderado([['retiro', 17], [emp === 'sanjavucho' ? 'moto' : 'moto_cba', 3]])
    return azar.ponderado([['correo', 3], ['expreso', 1], ['terminal', 1], [emp === 'sanjavucho' ? 'moto' : 'moto_cba', 1]])
  }
  let nGuia = 4100
  const guiaDe = (t) => `${PREFIJO_GUIA[t]}-${String(azar.entero(1000, 9999))}-${String(++nGuia).padStart(6, '0')}`

  // ───────────── Lecturas y pasos de ciclo de vida ─────────────
  const leerC = async (id) => (await adm.leer(`comprobantes_venta?id=eq.${id}&select=id,numero,estado,estado_despacho,updated_at,total_con_iva,total_sin_iva,empresa_id`, 'dominio'))[0]
  const vendedor = (emp, canal) => emp === 'sanjavucho' && canal === 'mostrador'
    ? azar.ponderado([[S.mostrador, 6], [S.operador, 3]]) : azar.ponderado([[S.operador, 7], [S.administracion, 2]])
  const cobradorDe = (emp, canal) => emp === 'sanjavucho' && canal === 'mostrador' ? S.mostrador : azar.ponderado([[S.administracion, 3], [emp === 'sanjavucho' ? S.mostrador : S.administracion, 1]])
  const formaId = (emp, clave) => ctx.formasPago[emp][clave]?.id ?? null
  const envioId = (emp, clave) => ctx.formasEnvio[emp][clave]?.id ?? null

  async function crear(s) {
    const emp = ctx.empresas[s.emp].id
    let c = await s.vend.rpc('crear_comprobante', {
      p_tipo: s.tipo, p_empresa_id: emp, p_cliente_id: s.cliente.id, p_canal: s.canal, p_fecha: s.fecha, p_valido_hasta: s.validoHasta ?? null,
      p_forma_pago_id: s.forma ? formaId(s.emp, s.forma) : null, p_envio_id: s.envio ? envioId(s.emp, s.envio) : null,
    })
    if (s.lineas?.length) c = await guardarLineas(s.vend, c, s.lineas)
    return c
  }
  const guardarLineas = (vend, c, lineas, manual = {}) => vend.rpc('guardar_lineas_comprobante', {
    p_id: c.id, p_actualizado_en: c.updated_at,
    p_lineas: lineas.map((l, i) => ({ producto_id: ctx.productos[l.sku].id, cantidad: l.cantidad, deposito_id: l.dep, ...(manual[i] !== undefined ? { precio_manual: manual[i] } : {}) })),
  })
  // Descuento a mano sobre las líneas (solo Operador y Administrador tienen `editar_precio`).
  async function conPrecioManual(vend, c, lineas, pct, soloPrimera = true) {
    const ob = await vend.rpc('obtener_comprobante', { p_id: c.id })
    const manual = {}
    ob.lineas.forEach((l, i) => { if (!soloPrimera || i === 0) manual[i] = Math.round(Number(l.precio_unitario) * (1 - pct) * 100) / 100 })
    return guardarLineas(vend, c, lineas, manual)
  }
  async function confirmar(vend, c) { return vend.rpc('confirmar_comprobante', { p_id: c.id }) }
  async function guardarEnvio(c, emp, envio, transporte, fechaFactura) {
    if (!transporte) return null
    const cur = await leerC(c.id)
    const hoy = fechaHaceDias(0)
    const f = sumarDias(fechaFactura, azar.entero(1, 2))
    return S.operador.rpc('guardar_envio_comprobante', { p_id: c.id, p_transporte_id: ctx.transportes[transporte].id, p_guia: guiaDe(transporte), p_fecha_envio: f > hoy ? hoy : f, p_actualizado_en: cur.updated_at })
  }
  // Máquina de despacho: arma (Depósito o Administrador), controla otra persona, entrega Depósito.
  async function despachar(c, objetivo, { admArma = false, faltantes = null, resolver = false } = {}) {
    const armador = admArma ? { s: adm, id: adm.userId } : { s: dep, id: dep.userId }
    const controlador = admArma ? { s: dep, id: dep.userId } : { s: adm, id: adm.userId }
    const paso = async (quien, estado) => {
      const cur = await leerC(c.id)
      await quien.s.rpc('cambiar_estado_despacho', { p_id: c.id, p_estado: estado, p_responsable_id: quien.id, p_actualizado_en: cur.updated_at })
    }
    let cur = await leerC(c.id)
    if (cur.estado_despacho === 'sin_armar' && objetivo !== 'sin_armar') await paso(armador, 'armando')
    if (faltantes) {
      cur = await leerC(c.id)
      await dep.rpc('registrar_faltantes_despacho', { p_id: c.id, p_faltantes: faltantes, p_actualizado_en: cur.updated_at })
      if (objetivo === 'incompleto') return
    }
    if (resolver) await paso(armador, 'armando') // Incompleto → Armando: cierra los faltantes abiertos
    cur = await leerC(c.id)
    if (['listo_para_despachar', 'entregado'].includes(objetivo) && cur.estado_despacho === 'armando') await paso(controlador, 'listo_para_despachar')
    if (objetivo === 'entregado') await paso({ s: dep, id: dep.userId }, 'entregado')
  }

  // ───────────── Cobros ─────────────
  const cuentaDe = (emp, forma) => forma === 'transferencia' ? (emp === 'sanjavucho' ? ctx.cuentasCobro.banco_sj : ctx.cuentasCobro.banco_jc) : forma === 'billetera' ? ctx.cuentasCobro.billetera : null
  function formaTotal(emp, tipo, canal) {
    if (tipo === 'mayorista') return azar.ponderado([['transferencia', 60], ['efectivo', 8], [emp === 'mundojc' ? 'cheque' : 'transferencia', 20], ['billetera', 4]])
    if (canal === 'mostrador') return azar.ponderado([['efectivo', 40], ['debito', 25], ['credito', 15], ['transferencia', 12], ['billetera', 8], ...(emp === 'sanjavucho' ? [['efectivo_usd', 4]] : [])])
    return azar.ponderado([['transferencia', 40], ['billetera', 28], ['credito', 20], ['debito', 12]])
  }
  // Cobros: total (a veces en dos partes), seña en efectivo (no cambia el estado) o a cuenta con una forma que deja deuda.
  function planCobros(emp, tipo, canal, totalC, modo, pref) {
    if (modo === 'senia') return [{ forma: 'efectivo', c: Math.round(totalC * (0.3 + azar.siguiente() * 0.2)) }]
    if (modo === 'deuda') {
      const forma = ['cuenta_corriente', 'cuotas', 'cheque'].includes(pref) ? pref : azar.ponderado([['cuenta_corriente', 55], ['cuotas', 25], [emp === 'mundojc' ? 'cheque' : 'cuenta_corriente', 20]])
      return [{ forma, c: Math.round(totalC * (0.3 + azar.siguiente() * 0.4)) }]
    }
    const f1 = pref && !['cuenta_corriente', 'cuotas', 'cheque', 'contrarreembolso'].includes(pref) ? pref : formaTotal(emp, tipo, canal)
    if (azar.probabilidad(0.2) && totalC > 20000) {
      const parte = Math.round(totalC * 0.5)
      return [{ forma: f1 === 'efectivo' ? 'transferencia' : 'efectivo', c: parte }, { forma: f1, c: totalC - parte }]
    }
    return [{ forma: f1, c: totalC }]
  }
  async function cobrar(c, emp, cobros, cobrador) {
    for (const x of cobros) {
      const cta = cuentaDe(emp, x.forma)
      await cobrador.rpc('registrar_cobro', { p_comprobante_id: c.id, p_importe: plata(x.c), p_forma_pago_id: formaId(emp, x.forma), p_cuenta_cobro_id: cta?.id ?? null })
    }
  }

  // ───────────── Slots: qué comprobantes se crean y cuándo ─────────────
  const rangoDias = {
    entregada_cobrada: [2, 88], entregada_deuda: [22, 80], pendiente: [1, 5], armando: [1, 6], incompleta: [2, 9], faltante_resuelto: [3, 14],
    lista: [1, 7], estado_documental: [2, 20], contrarreembolso: [3, 45], anulada: [4, 85], borrador: [8, 70], pedido: [1, 6],
    p_vencido: [26, 90], p_vigente: [1, 8], p_aceptado: [3, 40], p_convertido: [8, 80],
  }
  const slots = []
  for (const [cat, n] of Object.entries(CASOS_FACTURA)) if (cat !== 'convertida') for (let i = 0; i < n; i++) slots.push({ cat, i, tipo: 'factura' })
  for (const [cat, n] of Object.entries(CASOS_PRESUPUESTO)) for (let i = 0; i < n; i++) slots.push({ cat: `p_${cat}`, i, tipo: 'presupuesto' })
  for (const s of slots) { const [a, b] = rangoDias[s.cat]; s.dia = dia(a, b) }
  slots.sort((a, b) => b.dia - a.dia) // del más viejo al más nuevo: la numeración sigue a la fecha

  const reg = [] // lo creado, para las etapas posteriores (notas, RMA, rechazos, verificación)
  const falla = []
  const cuenta = {}
  const marca = (k) => { cuenta[k] = (cuenta[k] ?? 0) + 1 }
  const guardaPedido = { n: 0 }

  async function venderFactura(s) {
    const esMay = ['entregada_deuda'].includes(s.cat) || (['entregada_cobrada', 'convertida'].includes(s.cat) && azar.probabilidad(0.3)) || (s.cat === 'contrarreembolso' && azar.probabilidad(0.25)) || (['pendiente', 'lista', 'armando', 'anulada'].includes(s.cat) && azar.probabilidad(0.2))
    const tipo = esMay ? 'mayorista' : 'minorista'
    let cliente, emp
    if (s.cat === 'entregada_deuda') { cliente = deudores[s.i % deudores.length]; emp = azar.probabilidad(0.6) ? 'sanjavucho' : 'mundojc' } else {
      emp = s.cat === 'pedido' ? 'sanjavucho' : azar.ponderado([['sanjavucho', 6], ['mundojc', 4]])
      cliente = clienteDe(emp, tipo)
    }
    const canal = tipo === 'mayorista' ? azar.ponderado([['telefono_whatsapp', 6], ['tienda_online', 2], ['mostrador', 1]]) : s.cat === 'pedido' ? 'telefono_whatsapp' : azar.ponderado(s.cat === 'contrarreembolso' ? CANALES_ENVIO : (azar.probabilidad(0.5) ? CANALES_RETIRO : CANALES_ENVIO))
    const sinListo = ['pendiente', 'armando', 'incompleta', 'faltante_resuelto', 'estado_documental'].includes(s.cat)
    const cr = s.cat === 'contrarreembolso'
    let envio = decidirEnvio(emp, tipo, canal, { cr, sinListo })
    if (s.cat === 'pedido') envio = 'retiro'
    const transporte = transporteDe(emp, envio, cliente, cr)
    // Forma de pago de la cabecera: la que después se usa para cobrar (los borradores abandonados todavía no eligieron).
    const formaCab = cr ? 'contrarreembolso' : s.cat === 'borrador' ? null : s.cat === 'entregada_deuda' ? azar.ponderado([['cuenta_corriente', 55], ['cuotas', 25], [emp === 'mundojc' ? 'cheque' : 'cuenta_corriente', 20]]) : formaTotal(emp, tipo, canal)
    const fecha = fechaHaceDias(s.dia)
    const vend = s.cat === 'pedido' ? S.operador : vendedor(emp, canal)
    let lineas
    if (s.cat === 'pedido') lineas = [{ sku: PEDIDO.sku, cantidad: 1, dep: depPorNombre(s.i === 0 ? 'Depósito principal' : 'Local Corrientes') }]
    else if (s.cat === 'borrador' && s.i < 2) lineas = []
    else if (s.cat === 'borrador' && s.i === 5) lineas = [{ sku: 'CON-NSW-OLED', cantidad: 400, dep: depsEmpresa[emp][0] }]
    else lineas = armarLineas(emp, tipo, tipo === 'mayorista' ? 3 : (['entregada_cobrada'].includes(s.cat) ? 3 : 2))
    if (!lineas.length && s.cat !== 'borrador') throw new Error(`sin stock para armar el carrito (${s.cat})`)
    // Los demás datos del cobro dependen del total, que sale del servidor.
    let c = await crear({ ...s, emp, cliente, canal, fecha, vend, lineas, forma: formaCab, envio })
    const rec = { id: c.id, numero: c.numero, cat: s.cat, emp, tipo, cliente, canal, lineas, fecha, vend }
    reg.push(rec)
    marca(`factura:${s.cat}`)

    // Descuentos a mano: 6 ventas del Operador con la primera línea rebajada (la base marca el precio como manual).
    if (s.cat === 'entregada_cobrada' && s.i % 7 === 3 && vend === S.operador) c = await conPrecioManual(vend, c, lineas, 0.1), marca('precio_manual')

    if (s.cat === 'borrador') {
      if (emp === 'sanjavucho' && !rec.probadoPrecio && !reg.some((x) => x.probadoPrecio) && lineas.length) await rechazo('Mostrador no puede editar precios', /no puede editar precios/i, async () => { rec.probadoPrecio = true; return conPrecioManual(S.mostrador, c, lineas, 0.2) })
      if (s.i === 5) {
        await rechazo('confirmar con stock insuficiente (400 Switch OLED)', /No hay stock suficiente/i, () => confirmar(vend, c))
        rec.stockInsuficiente = true
      }
      return
    }
    c = await confirmar(vend, c)
    rec.total = cents(c.total_con_iva)
    const total = rec.total
    const cobrador = cobradorDe(emp, canal)
    const exige = ['correo', 'expreso', 'terminal'].includes(envio)

    // Envío: se carga antes de entregar (la base lo exige al entregar si la forma lo pide).
    const cargarEnvio = async () => { if (transporte) { await guardarEnvio(c, emp, envio, transporte, fecha); rec.transporte = transporte } }

    switch (s.cat) {
      case 'entregada_cobrada': case 'pedido': {
        if (s.cat === 'pedido' && s.i === 0) { rec.nota = 'reserva activa'; break } // «A pedido»: reserva, sin entregar
        await cargarEnvio(); await despachar(c, 'entregado', { admArma: azar.probabilidad(0.25) })
        await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'total', formaCab), cobrador)
        break
      }
      case 'entregada_deuda': {
        await cargarEnvio(); await despachar(c, 'entregado')
        await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'deuda', formaCab), cobrador)
        if (s.i % 4 === 1) { // saldan lo que debían con una transferencia posterior
          const saldo = (await S.administracion.rpc('saldo_comprobante', { p_id: c.id }))[0]
          await cobrar(c, emp, [{ forma: 'transferencia', c: cents(saldo.saldo) }], S.administracion)
          rec.saldada = true
        }
        break
      }
      case 'pendiente': {
        if (s.i % 3 === 0) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'senia', formaCab), cobrador)
        break
      }
      case 'armando': {
        await despachar(c, 'armando', { admArma: s.i % 3 === 2 })
        if (s.i < 2) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'senia', formaCab), cobrador)
        break
      }
      case 'incompleta': case 'faltante_resuelto': {
        const elegibles = lineas.map((l, k) => ({ orden: k + 1, cantidad: l.cantidad })).filter((l) => l.cantidad >= 2)
        const f = (elegibles.length ? elegibles : [{ orden: 1, cantidad: lineas[0].cantidad }]).slice(0, 2).map((l) => ({ linea_orden: l.orden, cantidad: Math.max(1, Math.min(l.cantidad, azar.entero(1, Math.max(1, Math.ceil(l.cantidad / 2))))) }))
        rec.faltantes = f
        if (s.cat === 'incompleta') { await despachar(c, 'incompleto', { faltantes: f }); break }
        await cargarEnvio()
        await despachar(c, 'armando'); await despachar(c, 'incompleto', { faltantes: f }); await despachar(c, s.i < 2 ? 'entregado' : 'listo_para_despachar', { resolver: true })
        if (s.i < 2) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'total', formaCab), cobrador)
        break
      }
      case 'lista': {
        // La primera queda con envío por expreso SIN transporte ni guía: sirve para probar que no se puede entregar así.
        if (s.i !== 0 || !exige) await cargarEnvio(); else rec.sinEnvio = true
        await despachar(c, 'listo_para_despachar', { admArma: s.i % 2 === 1 })
        if (s.i === 3) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'senia', formaCab), cobrador)
        break
      }
      case 'estado_documental': {
        const pasos = [['aceptado'], ['en_proceso'], ['aceptado', 'en_proceso'], ['aceptado', 'armando'], ['aceptado', 'armando', 'incompleto']][s.i % 5]
        for (const p of pasos) {
          const quien = ['armando', 'incompleto'].includes(p) ? dep : (emp === 'sanjavucho' ? S.mostrador : S.administracion)
          const cur = await leerC(c.id)
          await quien.rpc('cambiar_estado_comprobante', { p_id: c.id, p_estado: p, p_actualizado_en: cur.updated_at })
        }
        rec.nota = pasos.at(-1)
        if (s.i >= 5) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'total', formaCab), cobrador)
        break
      }
      case 'contrarreembolso': {
        await cargarEnvio()
        await despachar(c, s.i < 7 ? 'entregado' : 'listo_para_despachar')
        break
      }
      case 'anulada': {
        if (s.i < 2) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'senia', formaCab), cobrador)
        else if (s.i === 2) await cobrar(c, emp, planCobros(emp, tipo, canal, total, 'deuda', formaCab), cobrador)
        const cur = await leerC(c.id)
        await S.administracion.rpc('anular_comprobante', { p_id: c.id, p_motivo: MOTIVOS_ANULACION_VENTA[s.i % MOTIVOS_ANULACION_VENTA.length], p_actualizado_en: cur.updated_at })
        for (const l of lineas) disp.set(`${l.sku}|${l.dep}`, presupuesto(l.sku, l.dep) + l.cantidad) // el stock volvió
        rec.anulada = true
        break
      }
    }
    return rec
  }

  async function presupuestar(s) {
    const esMay = azar.probabilidad(0.25)
    const tipo = esMay ? 'mayorista' : 'minorista'
    const emp = azar.ponderado([['sanjavucho', 6], ['mundojc', 4]])
    const cliente = clienteDe(emp, tipo)
    const canal = azar.ponderado([['telefono_whatsapp', 5], ['tienda_online', 3], ['mostrador', 2]])
    const fecha = fechaHaceDias(s.dia)
    const vend = vendedor(emp, canal)
    const vigente = s.cat === 'p_vigente'
    const validez = vigente ? azar.entero(15, 30) : s.cat === 'p_vencido' ? Math.min(azar.entero(7, 21), s.dia - 2) : s.dia + azar.entero(3, 15) // aceptados y convertidos siguen vigentes
    // Los presupuestos no mueven stock: no se descuenta del presupuesto de venta.
    const lineas = armarLineas(emp, tipo, tipo === 'mayorista' ? 4 : 3)
    for (const l of lineas) disp.set(`${l.sku}|${l.dep}`, presupuesto(l.sku, l.dep) + l.cantidad)
    const envio = decidirEnvio(emp, tipo, canal)
    let c = await crear({ ...s, emp, cliente, canal, fecha, vend, lineas, validoHasta: sumarDias(fecha, validez), forma: azar.probabilidad(0.6) ? 'transferencia' : null, envio: azar.probabilidad(0.5) ? envio : null })
    const rec = { id: c.id, numero: c.numero, cat: s.cat, emp, tipo: 'presupuesto', cliente, canal, lineas, fecha, vend }
    reg.push(rec); marca(`presupuesto:${s.cat}`)
    if (vigente && s.i < 2 && [S.operador].includes(vend) === false) { /* sin permiso de precio: se deja como está */ }
    if (vigente && s.i < 2) { // presupuesto modificado: se rebaja la primera línea con el Operador
      c = await conPrecioManual(S.operador, c, lineas, 0.08)
      marca('presupuesto:modificado')
    }
    if (s.cat === 'p_aceptado' || s.cat === 'p_convertido') await vend.rpc('aceptar_presupuesto', { p_id: c.id })
    if (s.cat === 'p_convertido') { // no hay RPC de conversión: se factura lo mismo unos días después
      const lin = armarLineasIguales(emp, lineas)
      if (!lin.length) return rec
      const fFact = sumarDias(fecha, azar.entero(1, 3)) > fechaHaceDias(1) ? fechaHaceDias(1) : sumarDias(fecha, azar.entero(1, 3))
      const envF = decidirEnvio(emp, tipo, canal)
      const trF = transporteDe(emp, envF, cliente, false)
      let f = await crear({ tipo: 'factura', emp, cliente, canal, fecha: fFact, vend, lineas: lin, forma: null, envio: envF })
      f = await confirmar(vend, f)
      if (trF) await guardarEnvio(f, emp, envF, trF, fFact)
      await despachar(f, 'entregado')
      await cobrar(f, emp, planCobros(emp, tipo, canal, cents(f.total_con_iva), 'total'), cobradorDe(emp, canal))
      reg.push({ id: f.id, numero: f.numero, cat: 'convertida', emp, tipo, cliente, canal, lineas: lin, fecha: fFact, vend, total: cents(f.total_con_iva), presupuesto: c.numero })
      marca('factura:convertida')
    }
    return rec
  }
  // Las mismas líneas del presupuesto, si todavía hay stock (la factura sí lo descuenta); si no, las que se puedan.
  function armarLineasIguales(emp, lineas) {
    const out = []
    for (const l of lineas) {
      const hay = depsEmpresa[emp].map((d) => [d, presupuesto(l.sku, d)]).sort((a, b) => b[1] - a[1])[0]
      const cant = Math.min(l.cantidad, hay[1])
      if (cant < 1) continue
      disp.set(`${l.sku}|${hay[0]}`, hay[1] - cant)
      out.push({ sku: l.sku, cantidad: cant, dep: hay[0] })
    }
    return out
  }

  // ───────────── Corrida ─────────────
  for (const s of slots) {
    try { s.tipo === 'factura' ? await venderFactura(s) : await presupuestar(s) } catch (e) {
      falla.push(`${s.cat}#${s.i}: ${e.message}`)
      log(`ATENCIÓN · no se pudo crear ${s.cat} #${s.i}: ${e.message}`)
    }
  }
  log(`comprobantes creados: ${reg.length} (${Object.entries(cuenta).map(([k, v]) => `${k.replace(':', ' ')} ${v}`).join(', ')})`)

  // — Presupuestos copiados: se renueva un vencido —
  const vencidos = reg.filter((r) => r.cat === 'p_vencido')
  for (const v of vencidos.slice(0, PRESUPUESTOS_COPIADOS)) {
    try { const n = await S.operador.rpc('copiar_presupuesto', { p_id: v.id }); log(`presupuesto ${v.numero} (${v.emp}) vencido → copiado como ${n.numero}`); marca('presupuesto:copiado') } catch (e) { log(`ATENCIÓN · copiar presupuesto ${v.numero}: ${e.message}`) }
  }
  if (vencidos[0]) await rechazo('aceptar un presupuesto vencido', /vencid/i, () => S.operador.rpc('aceptar_presupuesto', { p_id: vencidos[0].id }))

  // ───────────── Notas de crédito ─────────────
  const base = azar.mezclar(reg.filter((r) => r.cat === 'entregada_cobrada' && r.tipo === 'minorista').concat(reg.filter((r) => r.cat === 'entregada_cobrada' && r.tipo === 'mayorista')))
  const usadas = new Set()
  const tomar = () => { const r = base.find((x) => !usadas.has(x.id)); if (r) usadas.add(r.id); return r }
  const notas = []
  for (const [tipoNC, n] of NOTAS_CREDITO) {
    for (let i = 0; i < n; i++) {
      const r = tomar(); if (!r) break
      try {
        const cur = await leerC(r.id)
        let lineasNC, concepto = null
        if (tipoNC === 'devolucion_productos') {
          const ob = await S.administracion.rpc('obtener_comprobante', { p_id: r.id })
          const l = ob.lineas[0]
          lineasNC = [{ linea_id: l.id, cantidad: Math.max(1, Math.floor(l.cantidad / (i % 2 ? 2 : 1)) - (i % 2 ? 0 : 0)) }]
          if (i % 2 === 0) lineasNC[0].cantidad = 1
          concepto = null
        } else {
          lineasNC = [{ importe_sin_iva: Math.round(Number(cur.total_sin_iva) * (0.1 + azar.siguiente() * 0.2) * 100) / 100 }]
          concepto = azar.elegir(CONCEPTOS_NC[tipoNC])
        }
        const nc = await S.administracion.rpc('emitir_nota_credito', { p_factura_id: r.id, p_tipo: tipoNC, p_lineas: lineasNC, p_concepto: concepto })
        notas.push({ ...r, nc: nc.numero, tipoNC }); marca(`nota:${tipoNC}`)
      } catch (e) { log(`ATENCIÓN · nota de crédito ${tipoNC}: ${e.message}`) }
    }
  }
  log(`${notas.length} notas de crédito (${NOTAS_CREDITO.map(([t]) => `${t} ${cuenta[`nota:${t}`] ?? 0}`).join(', ')})`)
  if (notas[0]) {
    await rechazo('nota de crédito por más de lo facturado', /No podés acreditar/i, () => S.administracion.rpc('emitir_nota_credito', { p_factura_id: notas[0].id, p_tipo: 'devolucion_importe', p_lineas: [{ importe_sin_iva: 99999999 }], p_concepto: 'Prueba' }))
    await rechazo('anular una factura que ya tiene nota de crédito', /nota de crédito/i, async () => { const cur = await leerC(notas[0].id); return S.administracion.rpc('anular_comprobante', { p_id: notas[0].id, p_motivo: 'Prueba', p_actualizado_en: cur.updated_at }) })
  }

  // ───────────── Devoluciones (RMA): las cinco formas y los tres estados ─────────────
  const paraRma = reg.filter((r) => ['entregada_cobrada', 'entregada_deuda', 'contrarreembolso', 'convertida'].includes(r.cat) && !r.anulada && !usadas.has(r.id) && r.total)
  const rmas = []
  for (const [forma, estado] of RMA_PLAN) {
    const r = paraRma.shift(); if (!r) break
    try {
      const ob = await S.operador.rpc('obtener_comprobante', { p_id: r.id })
      const l = ob.lineas[0]
      let rma = await S.operador.rpc('registrar_rma', { p_comprobante_id: r.id, p_lineas: [{ linea_id: l.id, cantidad: 1 }], p_forma_rma: forma, p_motivo: azar.elegir(MOTIVOS_RMA[forma]), p_observaciones: azar.elegir(OBSERVACIONES_RMA) })
      const mover = async (a) => { rma = await S.operador.rpc('cambiar_estado_rma', { p_id: rma.id, p_estado: a, p_actualizado_en: rma.actualizado_en }) }
      if (estado !== 'abierto') await mover('en_gestion')
      if (estado === 'cerrado') {
        if (forma === 'devolucion_importe') { // se cierra con una nota de crédito por el importe
          const cur = await leerC(r.id)
          const imp = Math.round(Number(l.precio_unitario) * 100) / 100
          rma = await S.administracion.rpc('vincular_nota_credito_rma', { p_rma_id: rma.id, p_tipo: 'devolucion_importe', p_lineas: [{ importe_sin_iva: Math.min(imp, Number(cur.total_sin_iva)) }], p_concepto: 'Reintegro por devolución' })
          marca('rma:con_nota')
        } else if (forma === 'cambio_directo') { rma = await adm.rpc('reingresar_stock_rma', { p_rma_id: rma.id }); marca('rma:con_reingreso') } else await mover('cerrado')
      }
      rmas.push({ id: rma.id, numero: rma.numero, forma, estado: rma.estado, comprobante: r.id, linea: l.id }); marca(`rma:${estado}`)
    } catch (e) { log(`ATENCIÓN · RMA ${forma}/${estado}: ${e.message}`) }
  }
  log(`${rmas.length} devoluciones RMA (${rmas.map((x) => `${x.forma}/${x.estado}`).join(', ')})`)
  if (rmas[0]) {
    await rechazo('RMA por más de lo vendido', /No podés devolver más/i, () => S.operador.rpc('registrar_rma', { p_comprobante_id: rmas[0].comprobante, p_lineas: [{ linea_id: rmas[0].linea, cantidad: 9999 }], p_forma_rma: 'cambio_directo', p_motivo: 'Prueba' }))
    const ab = rmas.find((x) => x.estado === 'abierto')
    if (ab) await rechazo('saltar de Abierta a Cerrada', /transici|estado|paso/i, async () => { const [fila] = await S.operador.rpc('listar_rma', { p_busqueda: ab.numero }); return S.operador.rpc('cambiar_estado_rma', { p_id: ab.id, p_estado: 'cerrado', p_actualizado_en: fila.actualizado_en }) })
  }

  // ───────────── Verificaciones de borde con los registros ya creados ─────────────
  const rj = (cat) => reg.find((r) => r.cat === cat && r.total)
  const pen = rj('pendiente'), arm = rj('armando'), lis = reg.find((r) => r.cat === 'lista' && r.sinEnvio), cob = reg.find((r) => r.cat === 'entregada_cobrada'), bor = reg.find((r) => r.cat === 'borrador' && r.id)
  if (pen) await rechazo('cobro mayor al saldo', /supera el saldo/i, () => S.administracion.rpc('registrar_cobro', { p_comprobante_id: pen.id, p_importe: plata(pen.total * 2), p_forma_pago_id: formaId(pen.emp, 'efectivo') }))
  if (bor) await rechazo('cobrar una factura en borrador', /estado operativo|borrador/i, () => S.administracion.rpc('registrar_cobro', { p_comprobante_id: bor.id, p_importe: 100, p_forma_pago_id: formaId(bor.emp, 'efectivo') }))
  if (cob) {
    await rechazo('anular una factura ya cobrada', /ya está cobrada/i, async () => { const cur = await leerC(cob.id); return S.administracion.rpc('anular_comprobante', { p_id: cob.id, p_motivo: 'Prueba', p_actualizado_en: cur.updated_at }) })
    await rechazo('editar las líneas de una factura confirmada', /cerrado/i, async () => { const cur = await leerC(cob.id); return guardarLineas(S.operador, { id: cob.id, updated_at: cur.updated_at }, cob.lineas) })
    await rechazo('HALLAZGO: despachar una factura ya cobrada', /Solo las facturas confirmadas/i, async () => { const cur = await leerC(cob.id); return adm.rpc('cambiar_estado_despacho', { p_id: cob.id, p_estado: 'armando', p_responsable_id: adm.userId, p_actualizado_en: cur.updated_at }) })
  }
  if (arm) {
    await rechazo('controlar quien armó el pedido', /no puede controlarlo/i, async () => { const cur = await leerC(arm.id); return dep.rpc('cambiar_estado_despacho', { p_id: arm.id, p_estado: 'listo_para_despachar', p_responsable_id: dep.userId, p_actualizado_en: cur.updated_at }) })
    const armador = arm.lineas.length
    await rechazo('faltante mayor a lo pedido', /entre 1 y/i, async () => { const cur = await leerC(arm.id); return dep.rpc('registrar_faltantes_despacho', { p_id: arm.id, p_faltantes: [{ linea_orden: 1, cantidad: arm.lineas[0].cantidad + 50 }], p_actualizado_en: cur.updated_at }) })
    void armador
  }
  if (lis) await rechazo('entregar un envío por expreso sin transporte ni guía', /^Una factura /i, async () => { const cur = await leerC(lis.id); return dep.rpc('cambiar_estado_despacho', { p_id: lis.id, p_estado: 'entregado', p_responsable_id: dep.userId, p_actualizado_en: cur.updated_at }) })
  await rechazo('Mostrador no puede vender en Mundo JC', /no puede crear comprobantes/i, () => S.mostrador.rpc('crear_comprobante', { p_tipo: 'factura', p_empresa_id: ctx.empresas.mundojc.id, p_cliente_id: todos[0].id, p_canal: 'mostrador' }))

  // ───────────── Verificación final (solo lectura) ─────────────
  const facs = await adm.leer('comprobantes_venta?select=id,numero,tipo,nc_tipo,estado,estado_despacho,total_sin_iva,total_con_iva,empresa_id&limit=5000', 'dominio')
  const por = (lista, k) => lista.reduce((a, x) => ({ ...a, [x[k] ?? '—']: (a[x[k] ?? '—'] ?? 0) + 1 }), {})
  const e = (x) => Object.entries(x).map(([k, v]) => `${k} ${v}`).join(', ')
  log(`comprobantes en la base: ${facs.length} (${e(por(facs, 'tipo'))})`)
  log(`facturas por estado: ${e(por(facs.filter((x) => x.tipo === 'factura'), 'estado'))}`)
  log(`facturas por despacho: ${e(por(facs.filter((x) => x.tipo === 'factura' && x.estado_despacho), 'estado_despacho'))}`)
  log(`presupuestos por estado: ${e(por(facs.filter((x) => x.tipo === 'presupuesto'), 'estado'))}`)
  const empresaDe = (id) => Object.keys(ctx.empresas).find((k) => ctx.empresas[k].id === id)
  log(`reparto por tienda: ${e(por(facs.map((x) => ({ k: empresaDe(x.empresa_id) })), 'k'))}`)
  const cobros = await adm.leer('cobros_comprobante?select=comprobante_id,importe&limit=10000', 'dominio')
  const cobrado = new Map()
  for (const c of cobros) cobrado.set(c.comprobante_id, (cobrado.get(c.comprobante_id) ?? 0) + cents(c.importe))
  const lins = await adm.leer('comprobantes_venta_lineas?select=comprobante_id,subtotal_sin_iva,iva&limit=20000', 'dominio')
  const sumaLin = new Map()
  for (const l of lins) { const a = sumaLin.get(l.comprobante_id) ?? [0, 0]; sumaLin.set(l.comprobante_id, [a[0] + cents(l.subtotal_sin_iva), a[1] + cents(l.iva)]) }
  let malTotal = 0, malCobro = 0, deudaTot = 0, cobradoTot = 0
  for (const f of facs) {
    const [s, i] = sumaLin.get(f.id) ?? [0, 0]
    // Las notas por importe o descuento no tienen líneas: su total es el importe acreditado.
    if (!['devolucion_importe', 'descuento'].includes(f.nc_tipo) && cents(f.total_con_iva) !== s + i) { malTotal++; log(`ATENCIÓN · ${f.tipo} ${f.numero}: total ${f.total_con_iva} ≠ líneas ${plata(s + i)}`) }
    if (f.tipo !== 'factura') continue
    const pagado = cobrado.get(f.id) ?? 0
    if (f.estado === 'cobrado') { if (pagado !== cents(f.total_con_iva)) { malCobro++; log(`ATENCIÓN · ${f.numero} cobrada con ${plata(pagado)} de ${f.total_con_iva}`) } cobradoTot += pagado }
    if (f.estado === 'deuda') { if (pagado >= cents(f.total_con_iva) || pagado === 0) { malCobro++; log(`ATENCIÓN · ${f.numero} en deuda con cobrado ${plata(pagado)}`) } deudaTot += cents(f.total_con_iva) - pagado }
  }
  log(`totales vs líneas: ${malTotal ? `${malTotal} con diferencia` : 'OK'}; cobrado + deuda vs total: ${malCobro ? `${malCobro} con diferencia` : 'OK'} (cobrado ${plata(cobradoTot).toLocaleString('es-AR')}, deuda abierta ${plata(deudaTot).toLocaleString('es-AR')})`)
  const exis = await adm.leer('existencias_deposito?select=cantidad,reservado&limit=5000', 'dominio')
  const malStock = exis.filter((x) => x.cantidad < 0 || x.reservado < 0 || x.reservado > x.cantidad).length
  log(`stock: ${malStock ? `ATENCIÓN · ${malStock} filas con negativos o reservado > cantidad` : 'OK (sin negativos ni reservado > cantidad)'}`)
  if (falla.length) log(`ATENCIÓN · ${falla.length} comprobantes no se pudieron crear (ver arriba)`)
}
