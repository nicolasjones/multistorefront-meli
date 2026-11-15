import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { CONTRASENA_E2E, UPSERT_FUSIONAR, altaUsuario, borrarUsuario, cabeceras, leer, limpiarOrganizacion, rest, serviceKey, url } from './soporte/fixtures'

// Listas de precios por cliente (F-PRE-14 y F-CLI-21), recorrido completo contra el stack local del CI: el administrador crea una
// lista (−20 %) y se la asigna a un cliente; se vende en el mostrador (factura de canal «mostrador») y la línea sale al precio de
// la lista con su marca «Lista: …» y su snapshot; la nota de crédito hereda el snapshot (la devolución es al precio cobrado) y
// cambiar el porcentaje después no mueve lo vendido; la tienda con cuenta web presupuesta al precio de la lista del cliente
// autenticado (el cliente sin lista paga el público); y con la bandera apagada el precio es el de siempre.
// Todo entra por las RPC de negocio con la sesión de la persona (administrador o cliente de la tienda), sin escribir con la
// service-role en tablas de solo lectura de `dominio`: la service-role solo SIEMBRA lo que el alta real también hace (organización,
// empresa, tienda, productos, stock, usuarios de Auth) y fija las banderas de plataforma. Las banderas `listas_precios` y
// `tienda_pedidos` se encienden SOLO en el stack efímero de la corrida y se devuelven a su valor previo al terminar.

const CLAVE_LISTAS = 'listas_precios'
const CLAVE_TIENDA = 'tienda_pedidos'
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const MENOS = '−'

async function fijarBandera(clave: string, activa: boolean): Promise<boolean | null> {
  const ruta = `banderas_plataforma?clave=eq.${clave}`
  const lectura = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const filas = lectura.ok ? ((await lectura.json()) as { activa: boolean }[]) : []
  if (filas.length === 0) return null
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras({ 'content-profile': 'public' }), body: JSON.stringify({ activa }) })
  if (!r.ok) throw new Error(`bandera ${clave}: ${r.status} ${await r.text()}`)
  return filas[0].activa
}

async function sesionDe(correo: string, clave: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password: clave }) })
  if (!r.ok) throw new Error(`sesión de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

// RPC de `public` con la sesión de una persona (RLS y roles de verdad). `perfil` es el esquema de la RPC (`publico` para la tienda).
async function rpc<T>(token: string, funcion: string, argumentos: unknown, perfil = 'public'): Promise<T> {
  const r = await fetch(`${url}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: cabeceras({ authorization: `Bearer ${token}`, 'content-profile': perfil, 'accept-profile': perfil }),
    body: JSON.stringify(argumentos),
  })
  if (!r.ok) throw new Error(`RPC ${funcion}: ${r.status} ${await r.text()}`)
  return (await r.json().catch(() => null)) as T
}

// Lectura con la sesión de la persona (RLS): nunca con la service-role.
async function comoPersona<T>(token: string, ruta: string, perfil: string): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ authorization: `Bearer ${token}`, 'accept-profile': perfil }) })
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(CONTRASENA_E2E)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

type Comprobante = { id: string; numero: string; updated_at: string }
type Linea = { id: string; precio_unitario: number; lista_precio_id: string | null; lista_ajuste_pct: number | null; orden: number }
type Presupuesto = { estado: string; numero?: string; total_con_iva?: number }
type Persona = { correo: string; authId: string; clienteId: string; token: string }

test.describe('Listas de precios · recorrido completo', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  const previas: Record<string, boolean | null> = {}
  let sufijo = ''
  let org = ''
  let empresa = ''
  let host = ''
  let deposito = ''
  let producto = ''
  let admin: { correo: string; id: string; token: string }
  let conLista: Persona
  let sinLista: Persona
  let listaId = ''
  const nombreLista = () => `Revendedores ${sufijo}`
  const personas: Persona[] = []

  async function sembrarCliente(etiqueta: string): Promise<Persona> {
    const correo = `lp-${etiqueta}-${sufijo}@example.com`
    // El alta del cliente la hace la persona del panel (administrador, con su sesión y RLS), como la pantalla de Clientes.
    const [cliente] = await comoAdmin<{ id: string }[]>('POST', 'clientes', { organizacion_id: org, nombre: `E2E ${etiqueta} ${sufijo}`, correo, tipo: 'minorista' })
    await rpc(admin.token, 'guardar_empresas_de_cliente', { p_cliente_id: cliente.id, p_empresa_ids: [empresa] })
    const authId = await altaUsuario(correo)
    // Solo el vínculo de la cuenta web usa la service-role (`vincular_cuenta_cliente`, lo que ejecuta la Edge Function de invitación).
    const vinculo = await fetch(`${url}/rest/v1/rpc/vincular_cuenta_cliente`, {
      method: 'POST', headers: cabeceras(), body: JSON.stringify({ p_cliente: cliente.id, p_empresa: empresa, p_auth_user: authId }),
    })
    if (!vinculo.ok) throw new Error(`vincular_cuenta_cliente: ${vinculo.status} ${await vinculo.text()}`)
    const persona = { correo, authId, clienteId: cliente.id, token: await sesionDe(correo, CONTRASENA_E2E) }
    personas.push(persona)
    return persona
  }

  async function comoAdmin<T>(metodo: string, ruta: string, cuerpo: unknown): Promise<T> {
    const r = await fetch(`${url}/rest/v1/${ruta}`, {
      method: metodo,
      headers: cabeceras({ authorization: `Bearer ${admin.token}`, prefer: 'return=representation' }),
      body: JSON.stringify(cuerpo),
    })
    if (!r.ok) throw new Error(`panel ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
    return (await r.json().catch(() => null)) as T
  }

  // Factura de mostrador con 3 unidades del producto; devuelve el comprobante y la línea guardada.
  async function facturar(cliente: Persona, confirmar: boolean): Promise<{ comprobante: Comprobante; linea: Linea }> {
    const comprobante = await rpc<Comprobante>(admin.token, 'crear_comprobante', {
      p_tipo: 'factura', p_empresa_id: empresa, p_cliente_id: cliente.clienteId, p_canal: 'mostrador', p_fecha: new Date().toISOString().slice(0, 10),
    })
    await rpc(admin.token, 'guardar_lineas_comprobante', {
      p_id: comprobante.id,
      p_lineas: [{ producto_id: producto, cantidad: 3, deposito_id: deposito }],
      p_actualizado_en: comprobante.updated_at,
    })
    if (confirmar) await rpc(admin.token, 'confirmar_comprobante', { p_id: comprobante.id })
    const lineas = await comoPersona<Linea>(admin.token, `comprobantes_venta_lineas?comprobante_id=eq.${comprobante.id}&select=id,precio_unitario,lista_precio_id,lista_ajuste_pct,orden`, 'dominio')
    expect(lineas).toHaveLength(1)
    return { comprobante, linea: lineas[0] }
  }

  async function presupuestar(persona: Persona, clave: string): Promise<Presupuesto> {
    return rpc<Presupuesto>(persona.token, 'crear_presupuesto_tienda', { host, items: [{ producto_id: producto, cantidad: 1 }], nota: null, clave_envio: clave }, 'publico')
  }

  test.beforeAll(async () => {
    previas[CLAVE_LISTAS] = await fijarBandera(CLAVE_LISTAS, true)
    previas[CLAVE_TIENDA] = await fijarBandera(CLAVE_TIENDA, true)
    test.skip(previas[CLAVE_LISTAS] === null, 'La base no tiene la bandera `listas_precios`.')

    sufijo = randomUUID().slice(0, 8)
    const [organizacion] = await rest<{ id: string }>('organizaciones', { nombre: `E2E listas ${sufijo}` })
    org = organizacion.id
    const [emp] = await rest<{ id: string }>('empresas', { organizacion_id: org, nombre: `Tienda listas ${sufijo}`, activa: true }, 'dominio')
    empresa = emp.id
    host = `listas-${sufijo}.localhost`
    await rest('tiendas', { organizacion_id: org, empresa_id: empresa, dominio: host }, 'dominio')
    const [dep] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org}&por_defecto=eq.true&select=id`, 'dominio')
    deposito = dep.id
    await rest('depositos_empresas', { deposito_id: deposito, empresa_id: empresa, organizacion_id: org }, 'dominio')

    // Categoría con IVA 21 % (nacen así) y un producto SIN precio propio ni escala: el precio sale de la lista o de la regla de la tienda.
    const [categoria] = await rest<{ id: string }>('categorias', { organizacion_id: org, nombre: `Con IVA ${sufijo}` }, 'dominio')
    const [prod] = await rest<{ id: string }>('productos', { organizacion_id: org, nombre: `Joystick lista ${sufijo}`, sku: `LP-${sufijo}`, precio_lista: 1000, moneda: 'ARS', categoria_id: categoria.id }, 'dominio')
    producto = prod.id
    await rest('producto_empresa', { producto_id: producto, empresa_id: empresa, organizacion_id: org }, 'dominio')
    await rest('existencias?on_conflict=producto_id', [{ producto_id: producto, organizacion_id: org, cantidad: 50, reservado: 0 }], 'dominio', UPSERT_FUSIONAR)
    await rest('existencias_deposito', [{ producto_id: producto, deposito_id: deposito, organizacion_id: org, cantidad: 50, reservado: 0 }], 'dominio')

    const correo = `admin-listas-${sufijo}@example.com`
    const id = await altaUsuario(correo)
    await rest('usuarios_organizacion', { user_id: id, organizacion_id: org, rol_id: 'administrador' })
    await rest('usuario_empresa_activa', { user_id: id, empresa_id: empresa })
    admin = { correo, id, token: await sesionDe(correo, CONTRASENA_E2E) }

    conLista = await sembrarCliente('con-lista')
    sinLista = await sembrarCliente('sin-lista')
  })

  test.afterAll(async () => {
    for (const clave of [CLAVE_LISTAS, CLAVE_TIENDA]) {
      if (previas[clave] !== undefined && previas[clave] !== null) await fijarBandera(clave, previas[clave] as boolean).catch(() => undefined)
    }
    for (const p of personas) await borrarUsuario(p.authId)
    if (admin) await borrarUsuario(admin.id)
    if (org) await limpiarOrganizacion(org)
  })

  test('el administrador crea la lista, la asigna y el mostrador cobra al precio de la lista', async ({ page }) => {
    listaId = await rpc<string>(admin.token, 'guardar_lista_precios', { p_id: null, p_nombre: nombreLista(), p_descripcion: null, p_ajuste_pct: -20, p_actualizado: null })
    expect(listaId).toMatch(/^[0-9a-f-]{36}$/)
    await rpc(admin.token, 'asignar_lista_precios_cliente', { p_cliente: conLista.clienteId, p_lista: listaId })
    const asignados = await comoPersona<{ lista_precio_id: string | null }>(admin.token, `clientes?id=eq.${conLista.clienteId}&select=lista_precio_id`, 'public')
    expect(asignados[0]?.lista_precio_id).toBe(listaId)

    // Sin lista: el precio de siempre (1.000). Con lista: central × 0,80 = 800, con su snapshot.
    const base = await facturar(sinLista, false)
    expect(Number(base.linea.precio_unitario)).toBe(1000)
    expect(base.linea.lista_precio_id).toBeNull()
    const borrador = await facturar(conLista, false)
    expect(Number(borrador.linea.precio_unitario)).toBe(800)
    expect(borrador.linea.lista_precio_id).toBe(listaId)
    expect(Number(borrador.linea.lista_ajuste_pct)).toBe(-20)

    // El comprobante en edición muestra la marca de la lista.
    await ingresar(page, admin.correo)
    await page.goto(`/ventas/comprobantes/${borrador.comprobante.id}`)
    await expect(page.getByText(`Lista: ${nombreLista()} ${MENOS}20 %`)).toBeVisible()
    await page.goto(`/ventas/comprobantes/${base.comprobante.id}`)
    await expect(page.getByRole('row').filter({ hasText: `Joystick lista ${sufijo}` })).toBeVisible()
    await expect(page.getByText('Lista:')).toHaveCount(0)
  })

  test('la factura confirmada conserva el snapshot y la nota de crédito lo hereda aunque la lista cambie', async () => {
    const { comprobante, linea } = await facturar(conLista, true)
    expect(Number(linea.precio_unitario)).toBe(800)
    expect(Number(linea.lista_ajuste_pct)).toBe(-20)

    const nota = await rpc<{ id: string }>(admin.token, 'emitir_nota_credito', {
      p_factura_id: comprobante.id, p_tipo: 'devolucion_productos', p_lineas: [{ linea_id: linea.id, cantidad: 1 }], p_concepto: null,
    })
    const lineasNota = await comoPersona<Linea>(admin.token, `comprobantes_venta_lineas?comprobante_id=eq.${nota.id}&select=id,precio_unitario,lista_precio_id,lista_ajuste_pct,orden`, 'dominio')
    expect(lineasNota).toHaveLength(1)
    expect(Number(lineasNota[0].precio_unitario)).toBe(800)
    expect(lineasNota[0].lista_precio_id).toBe(listaId)
    expect(Number(lineasNota[0].lista_ajuste_pct)).toBe(-20)

    // Cambiar el porcentaje después (−45 %) no mueve lo ya vendido ni la nota.
    const [resumen] = await comoPersona<{ updated_at: string }>(admin.token, `listas_precios_resumen?id=eq.${listaId}&select=updated_at`, 'public')
    await rpc(admin.token, 'guardar_lista_precios', { p_id: listaId, p_nombre: nombreLista(), p_descripcion: null, p_ajuste_pct: -45, p_actualizado: resumen.updated_at })
    for (const id of [comprobante.id, nota.id]) {
      const [l] = await comoPersona<Linea>(admin.token, `comprobantes_venta_lineas?comprobante_id=eq.${id}&select=id,precio_unitario,lista_precio_id,lista_ajuste_pct,orden`, 'dominio')
      expect(Number(l.precio_unitario)).toBe(800)
      expect(Number(l.lista_ajuste_pct)).toBe(-20)
    }
    // Y se vuelve a −20 % para el resto del recorrido.
    const [tras] = await comoPersona<{ updated_at: string }>(admin.token, `listas_precios_resumen?id=eq.${listaId}&select=updated_at`, 'public')
    await rpc(admin.token, 'guardar_lista_precios', { p_id: listaId, p_nombre: nombreLista(), p_descripcion: null, p_ajuste_pct: -20, p_actualizado: tras.updated_at })
  })

  test('la tienda presupuesta al precio de la lista del cliente autenticado y el cliente sin lista paga el público', async () => {
    const publico = await presupuestar(sinLista, `lp-sin-${sufijo}`)
    const conPrecioLista = await presupuestar(conLista, `lp-con-${sufijo}`)
    expect(publico.estado).toBe('ok')
    expect(conPrecioLista.estado).toBe('ok')
    // Mismo producto, misma tienda: la lista del −20 % baja el total en un 20 % (IVA incluido en ambos).
    expect(Number(publico.total_con_iva)).toBeGreaterThan(0)
    expect(Math.abs(Number(conPrecioLista.total_con_iva) - Number(publico.total_con_iva) * 0.8)).toBeLessThanOrEqual(1)
  })

  test('con la bandera apagada el precio es el de siempre aunque el cliente tenga lista', async () => {
    await fijarBandera(CLAVE_LISTAS, false)
    const { linea } = await facturar(conLista, false)
    expect(Number(linea.precio_unitario)).toBe(1000)
    expect(linea.lista_precio_id).toBeNull()
    const apagada = await presupuestar(conLista, `lp-apagada-${sufijo}`)
    const publico = await presupuestar(sinLista, `lp-sin2-${sufijo}`)
    expect(Number(apagada.total_con_iva)).toBe(Number(publico.total_con_iva))
  })
})
