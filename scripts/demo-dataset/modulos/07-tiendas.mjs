// Módulo 07 · Tiendas online (identidad, textos, envíos, catálogo visible) y consultas de clientes.
// Requiere las tiendas con dominio (sql/01-tiendas.sql) y se completa con sql/90-consultas.sql (ver ahí el porqué).
import { CONSULTAS_PUBLICAS, ESTADOS_CONSULTA, INTERES_PUBLICO, TIENDAS } from '../datos/tiendas.mjs'

export const nombre = 'Tiendas online y consultas'

// Camino anónimo, tal como lo usa el sitio: RPC del esquema `publico` con la anon key (sin sesión).
// El visitante se identifica por la IP de `x-forwarded-for` (hash en la base) y el límite es de 5 envíos por hora
// por visitante y empresa; por eso cada consulta sale con una IP de documentación (TEST-NET) distinta.
async function rpcPublica(cfg, funcion, args, ip) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: { apikey: cfg.anon, authorization: `Bearer ${cfg.anon}`, 'content-type': 'application/json', 'content-profile': 'publico', 'x-forwarded-for': ip },
    body: JSON.stringify(args),
  })
  const texto = await r.text()
  let cuerpo = null
  try { cuerpo = texto ? JSON.parse(texto) : null } catch { cuerpo = texto }
  if (!r.ok) throw new Error(`publico.${funcion} → ${r.status}: ${typeof cuerpo === 'object' && cuerpo ? (cuerpo.message || JSON.stringify(cuerpo)) : cuerpo}`)
  return cuerpo
}

export async function sembrar(ctx) {
  const { log, azar, cfg } = ctx
  const adm = await ctx.sesion('admin')
  const sufijo = process.env.DEMO_SUFIJO ?? ''
  // Los dominios son únicos en toda la plataforma: con DEMO_SUFIJO cada organización paralela tiene los suyos.
  const dominios = Object.fromEntries(Object.entries(TIENDAS).map(([c, t]) => [c, `${t.dominio}${sufijo}.localhost`]))

  // Un uuid reproducible (la clave de idempotencia del formulario) a partir del PRNG con semilla.
  const uuid = () => {
    const h = Array.from({ length: 32 }, () => azar.entero(0, 15).toString(16)).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`
  }
  let ipN = 0
  const ipNueva = () => { ipN += 1; return `203.0.113.${(ipN % 250) + 1}` }

  // — 1. Tienda de cada empresa: el dominio solo lo da de alta el equipo técnico (docs/tiendas-online.md, FR-004), no
  // hay RPC ni política de escritura. Se intenta como Administrador; si la base no lo permite se avisa y se sigue con
  // lo que sí se puede configurar, pero las consultas públicas necesitan la tienda.
  const existentes = await adm.leer('tiendas?select=empresa_id,dominio', 'dominio')
  const conTienda = {}
  for (const [clave, t] of Object.entries(TIENDAS)) {
    const emp = ctx.empresas[clave]
    const previa = existentes.find((x) => x.empresa_id === emp.id)
    if (previa) { conTienda[clave] = previa.dominio; continue }
    try {
      await adm.insertar('tiendas', { organizacion_id: ctx.orgId, empresa_id: emp.id, dominio: dominios[clave] }, 'dominio')
      conTienda[clave] = dominios[clave]
    } catch (e) {
      log(`⚠ ${emp.nombre}: no se pudo dar de alta la tienda (${dominios[clave]}): ${e.message}`)
    }
  }
  log(`tiendas con dominio: ${Object.entries(conTienda).map(([c, d]) => `${ctx.empresas[c].nombre} → ${d}`).join(' · ') || 'ninguna'}`)

  // — 2. Identidad visual y textos (RPC con edición en Empresas) —
  for (const [clave, t] of Object.entries(TIENDAS)) {
    const id = ctx.empresas[clave].id
    const i = t.identidad
    await adm.rpc('guardar_tienda_identidad', {
      p_empresa_id: id, p_color_primario: i.primario, p_color_primario_oscuro: i.oscuro, p_color_acento: i.acento, p_color_fondo: i.fondo,
      p_tipografia_titulos: i.titulos, p_tipografia_texto: i.texto,
    })
    const c = t.contenido
    await adm.rpc('guardar_tienda_contenido', {
      p_empresa_id: id, p_titulo: c.titulo, p_subtitulo: c.subtitulo, p_texto_boton: c.texto_boton, p_boton_destino: c.boton_destino,
      p_bienvenida: c.bienvenida, p_pie: c.pie, p_aviso_ficha: c.aviso_ficha, p_texto_boton_contacto: c.texto_boton_contacto,
    })
  }
  log('identidad visual (San Javucho violeta/Barlow Condensed · Mundo JC naranja/Sora) y textos; Mundo JC con subtítulo, pie y avisos vacíos')

  // — 3. Formas de envío de la tienda (si otro módulo ya las cargó, no se duplican) —
  const formas = await adm.leer('formas_envio?select=empresa_id,nombre', 'dominio')
  let nEnvios = 0
  for (const [clave, t] of Object.entries(TIENDAS)) {
    for (const f of t.envios) {
      if (formas.some((x) => x.empresa_id === ctx.empresas[clave].id && x.nombre === f.nombre)) continue
      await adm.rpc('crear_forma_envio', {
        p_empresa_ids: [ctx.empresas[clave].id], p_nombre: f.nombre, p_tipo: f.tipo, p_exige_transporte_guia: f.guia,
        p_costo_defecto: f.costo, p_estado_despacho_inicial: f.inicial, p_orden: f.orden, p_activo: true,
      })
      nEnvios += 1
    }
  }
  log(`${nEnvios} formas de envío`)

  // — 4. Catálogo publicado: qué categorías y productos se ven en cada tienda —
  // La visibilidad por defecto es «visible, no destacado»; se mandan solo los cambios. El árbol de categorías es de la
  // organización y lo comparten las dos tiendas, así que Belleza se oculta en San Javucho y Herramientas/Repuestos en Mundo JC.
  for (const [clave, t] of Object.entries(TIENDAS)) {
    const emp = ctx.empresas[clave]
    const enTienda = (sku) => ctx.productos[sku] && ctx.categorias[ctx.productos[sku].categoria]?.def.empresas.includes(clave)
    const categorias = []
    for (const raiz of t.categoriasOcultas) {
      const def = ctx.categorias[raiz]
      categorias.push({ id: def.id, visible: false })
      for (const h of def.def.nombre === raiz ? def.def.hijas : []) categorias.push({ id: ctx.categorias[h].id, visible: false })
    }
    const productos = [
      ...t.productosOcultos.filter(enTienda).map((sku) => ({ id: ctx.productos[sku].id, visible: false, destacado: false })),
      ...t.destacados.filter(enTienda).map((sku) => ({ id: ctx.productos[sku].id, visible: true, destacado: true })),
    ]
    const r = await adm.rpc('guardar_catalogo_tienda', { p_empresa: emp.id, p_categorias: categorias, p_productos: productos })
    log(`${emp.nombre}: ${categorias.length} categorías ocultas, ${t.productosOcultos.length} productos ocultos → ${r.visibles} visibles, ${r.destacados} destacados`)
  }

  // — 5. Estados de consulta (lista configurable) y correo de avisos —
  const yaEstados = new Set((await adm.leer('estados_consulta?select=nombre', 'dominio')).map((e) => e.nombre.toLowerCase()))
  for (const e of ESTADOS_CONSULTA) {
    if (yaEstados.has(e.nombre.toLowerCase())) continue
    const [fila] = await adm.rpc('crear_estado_consulta', { p_nombre: e.nombre })
    if (!e.activo) await adm.rpc('cambiar_estado_estado_consulta', { p_id: fila.id, p_activo: false })
  }
  log(`${ESTADOS_CONSULTA.length} estados de consulta (1 desactivado)`)
  for (const [clave, t] of Object.entries(TIENDAS)) {
    if (t.correoAvisos) await adm.rpc('guardar_correo_avisos_consultas', { p_empresa_id: ctx.empresas[clave].id, p_correo: t.correoAvisos, p_updated_at: null })
  }

  // — 6. Consultas por el camino público real, como visitante anónimo de cada tienda —
  // Pocas a propósito (el límite es de 5 por hora y empresa y la fecha es siempre «ahora»): sirven para probar el camino
  // de punta a punta. El resto de la bandeja, con fechas repartidas, la carga sql/90-consultas.sql.
  const faltan = Object.keys(TIENDAS).filter((c) => !conTienda[c])
  if (faltan.length) { log(`sin tienda con dominio en ${faltan.join(', ')} (las da de alta sql/01-tiendas.sql): se omiten las consultas`); return }
  let enviadas = 0
  for (const clave of Object.keys(TIENDAS)) {
    const host = conTienda[clave]
    const pub = CONSULTAS_PUBLICAS[clave]
    const pedidos = [
      ...pub.formulario.map(([n, c, m]) => ['enviar_consulta_contacto', { host, nombre: n, contacto: c, mensaje: m, clave_envio: uuid() }]),
      ...pub.whatsapp.map((sku) => ['registrar_consulta_whatsapp', { host, producto: ctx.productos[sku].id, clave_envio: uuid() }]),
    ]
    for (const [funcion, args] of pedidos) {
      const r = await rpcPublica(cfg, funcion, args, ipNueva())
      if (r?.estado !== 'ok') throw new Error(`${funcion} (${clave}) respondió ${JSON.stringify(r)}`)
      enviadas += 1
    }
  }
  log(`${enviadas} consultas por el camino público (formulario y WhatsApp)`)

  // — 7. Interés de WhatsApp por la RPC pública —
  let toques = 0
  for (const [clave, skus] of Object.entries(INTERES_PUBLICO)) {
    for (const sku of skus) {
      await rpcPublica(cfg, 'registrar_interes_whatsapp', { host: conTienda[clave], producto_id: ctx.productos[sku].id }, ipNueva())
      toques += 1
    }
  }
  log(`${toques} toques de interés por WhatsApp (el resto, en sql/90-consultas.sql)`)
}
