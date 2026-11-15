import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { altaUsuario, borrarUsuario, cabeceras, CONTRASENA_E2E, leer, limpiarOrganizacion, rest, serviceKey, url } from './soporte/fixtures'

// MSF-176 · historia B2 «Presupuesto desde la tienda» (T061; SC-003, SC-005, SC-006; escenarios B2-1 a B2-11): un cliente mayorista con cuenta activa ingresa, arma su lista, pide el presupuesto (cotización del servidor,
// «lo que ves es lo que se crea»), el operador lo ve `pendiente` en Ventas › Presupuestos con operador «Tienda online (cliente)», lo acepta con el flujo actual y no hay ningún movimiento de stock ni cobro; el sexto presupuesto
// del día muestra el aviso; dos llamadas SIMULTÁNEAS con 4 creados hoy crean exactamente una (el lock por cuenta, con sesiones de verdad); la misma clave devuelve el mismo número; lo que manda el cliente (cliente_id, precio…)
// no cambia nada; la bandera apagada y el anónimo no llegan. Con tiendas, productos y personas PROPIOS de la corrida (la baja de la organización se lleva todo): así los cupos por hora de la tienda (5 por IP) y los topes por
// cuenta no se comparten con otros specs. Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role key nunca llega al navegador) y SIN escritura directa en las
// tablas de solo lectura de `dominio` (`pnpm e2e:escritura:check`): el presupuesto entra solo por la RPC pública de la propia tienda. La función está detrás de la bandera `tienda_pedidos` (apagada por defecto): el spec la
// enciende y devuelve su valor previo al terminar. Si la base todavía no tiene la tabla de B2, se omite con ese motivo (en el job `e2e-tienda` esa omisión hace fallar `e2e:omitidos:check --max=1`).

const CLAVE = 'Clave-Segura-123!'
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

async function fijarBandera(activa: boolean): Promise<boolean | null> {
  const ruta = 'banderas_plataforma?clave=eq.tienda_pedidos'
  const lectura = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const filas = lectura.ok ? ((await lectura.json()) as { activa: boolean }[]) : []
  if (filas.length === 0) return null
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras({ 'content-profile': 'public' }), body: JSON.stringify({ activa }) })
  if (!r.ok) throw new Error(`bandera tienda_pedidos: ${r.status} ${await r.text()}`)
  return filas[0].activa
}

// ¿La base ya tiene `dominio.presupuestos_tienda` (historia B2)? Una tabla inexistente responde 404.
async function hayTablaDeB2(): Promise<boolean> {
  const r = await fetch(`${url}/rest/v1/presupuestos_tienda?select=id&limit=1`, { headers: cabeceras({ 'accept-profile': 'dominio' }) })
  return r.status !== 404
}

async function admin<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${url}/auth/v1/admin/${ruta}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`Auth admin ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function sesionDe(correo: string, clave: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password: clave }) })
  if (!r.ok) throw new Error(`sesión de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

type Tienda = { host: string; empresa: string }
type Producto = { id: string; nombre: string; sku: string }
type Cliente = { correo: string; authId: string; clienteId: string; token: string }
type Respuesta = { estado: string; numero?: string; fecha?: string; total_con_iva?: number; espera_segundos?: number; producto_id?: string; campos?: string[] }

test.describe('Tienda · presupuesto desde la tienda (B2)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // Los tests comparten la bandera (global) y la siembra: en serie.
  test.describe.configure({ mode: 'serial' })

  let banderaPrevia: boolean | null = null
  let sufijo = ''
  let org = ''
  let principal: Tienda
  let segunda: Tienda
  let alfa: Producto
  let beta: Producto
  let alfa2: Producto
  let operador: { correo: string; id: string }
  let panelToken = ''
  const clientes: Cliente[] = []
  let mayorista: Cliente
  let otro: Cliente
  let concurrente: Cliente

  const origen = (t: Tienda) => `http://${t.host}:${puerto}`

  async function comoPanel<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await fetch(`${url}/rest/v1/${ruta}`, {
      method: metodo,
      headers: cabeceras({ authorization: `Bearer ${panelToken}`, prefer: 'return=representation' }),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    if (!r.ok) throw new Error(`panel ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
    return (await r.json().catch(() => null)) as T
  }

  // Cliente de la tienda, habilitado en ella, con usuario de Auth (contraseña `CLAVE`) y cuenta web activa. Se da de alta como la persona del panel (administrador con su sesión y RLS), igual que la
  // pantalla de Clientes; solo el vínculo de la cuenta usa la service-role (`vincular_cuenta_cliente`, lo que ejecuta la Edge Function de invitación).
  async function sembrarCliente(tienda: Tienda, etiqueta: string, extra: Record<string, unknown>): Promise<Cliente> {
    const sufijoCliente = randomUUID().slice(0, 8)
    const correo = `presupuesto-${etiqueta}-${sufijoCliente}@example.com`
    // `descuento` no se puede dar de alta con el INSERT (solo se actualiza: columna sin grant de inserción): se fija después, como la ficha del cliente.
    const { descuento, ...alta } = extra
    const [cliente] = await comoPanel<{ id: string }[]>('POST', 'clientes', { organizacion_id: org, nombre: `E2E ${etiqueta} ${sufijoCliente}`, correo, ...alta })
    if (descuento !== undefined) await comoPanel('PATCH', `clientes?id=eq.${cliente.id}`, { descuento })
    await comoPanel('POST', 'rpc/guardar_empresas_de_cliente', { p_cliente_id: cliente.id, p_empresa_ids: [tienda.empresa] })
    const usuario = await admin<{ id: string }>('users', { email: correo, email_confirm: true, password: CLAVE })
    const vinculo = await fetch(`${url}/rest/v1/rpc/vincular_cuenta_cliente`, {
      method: 'POST', headers: cabeceras(), body: JSON.stringify({ p_cliente: cliente.id, p_empresa: tienda.empresa, p_auth_user: usuario.id }),
    })
    if (!vinculo.ok) throw new Error(`vincular_cuenta_cliente: ${vinculo.status} ${await vinculo.text()}`)
    const sembrado = { correo, authId: usuario.id, clienteId: cliente.id, token: await sesionDe(correo, CLAVE) }
    clientes.push(sembrado)
    return sembrado
  }

  async function sembrarTienda(nombre: string): Promise<Tienda> {
    const [emp] = await rest<{ id: string }>('empresas', { organizacion_id: org, nombre: `${nombre} ${sufijo}` }, 'dominio')
    const host = `${nombre.toLowerCase().replace(/[^a-z]/g, '')}-${sufijo}.localhost`
    await rest('tiendas', { organizacion_id: org, empresa_id: emp.id, dominio: host }, 'dominio')
    // El depósito por defecto de la organización (lo siembra el alta) vende para esta tienda.
    const [deposito] = await leer<{ id: string }>(`depositos?select=id&organizacion_id=eq.${org}&por_defecto=eq.true`, 'dominio')
    await rest('depositos_empresas', { deposito_id: deposito.id, empresa_id: emp.id, organizacion_id: org }, 'dominio')
    return { host, empresa: emp.id }
  }

  async function sembrarProducto(tienda: Tienda, nombre: string, sku: string, precio: number, categoria: string): Promise<Producto> {
    const [producto] = await rest<{ id: string }>('productos', { organizacion_id: org, nombre, sku, precio_lista: precio, moneda: 'ARS', categoria_id: categoria }, 'dominio')
    await rest('producto_empresa', { producto_id: producto.id, empresa_id: tienda.empresa, organizacion_id: org }, 'dominio')
    return { id: producto.id, nombre, sku }
  }

  // La RPC pública de la propia tienda, con la sesión del cliente (lo mismo que hace la pantalla).
  async function crearPorApi(cliente: Cliente, tienda: Tienda, items: unknown, clave: string, nota: string | null = null): Promise<Respuesta> {
    const r = await fetch(`${url}/rest/v1/rpc/crear_presupuesto_tienda`, {
      method: 'POST',
      headers: cabeceras({ authorization: `Bearer ${cliente.token}`, 'content-profile': 'publico', 'accept-profile': 'publico' }),
      body: JSON.stringify({ host: tienda.host, items, nota, clave_envio: clave }),
    })
    if (!r.ok) throw new Error(`crear_presupuesto_tienda: ${r.status} ${await r.text()}`)
    return (await r.json()) as Respuesta
  }

  const lista = (producto: Producto, cantidad: number) => ({ producto_id: producto.id, cantidad })
  const claveLista = (t: Tienda) => `msf.lista-pedido.v1:${puerto ? `${t.host}:${puerto}` : t.host}`
  const guardarLista = (page: Page, tienda: Tienda, lineas: Array<{ p: string; c: number }>) =>
    page.evaluate(([clave, valor]) => window.localStorage.setItem(clave, valor), [claveLista(tienda), JSON.stringify(lineas)] as const)

  async function ingresar(page: Page, tienda: Tienda, cliente: Cliente) {
    await page.goto(`${origen(tienda)}/ingresar`)
    await page.getByLabel(/^Correo/).fill(cliente.correo)
    await page.getByLabel(/^Contraseña/).fill(CLAVE)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page.getByRole('link', { name: 'Mi cuenta' })).toBeVisible()
  }

  async function violacionesAxe(page: Page): Promise<string[]> {
    await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core') })
    return page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: unknown[] }[] }[] }> } }).axe
      const resultado = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
      return resultado.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
    })
  }

  test.beforeAll(async () => {
    test.skip(!(await hayTablaDeB2()), 'La base no tiene todavía la tabla de la historia B2 de `tienda-compra-y-cuentas`.')
    banderaPrevia = await fijarBandera(true)
    test.skip(banderaPrevia === null, 'La base no tiene la bandera `tienda_pedidos`.')

    sufijo = randomUUID().slice(0, 8)
    const [organizacion] = await rest<{ id: string }>('organizaciones', { nombre: `E2E presupuesto ${sufijo}` })
    org = organizacion.id
    principal = await sembrarTienda('Principal')
    segunda = await sembrarTienda('Segunda')
    // Categoría con IVA 21 % (las categorías nacen en 21 %).
    const [categoria] = await rest<{ id: string }>('categorias', { organizacion_id: org, nombre: `Con IVA ${sufijo}` }, 'dominio')
    alfa = await sembrarProducto(principal, `Alfa ${sufijo}`, `ALF-${sufijo}`, 1000, categoria.id)
    beta = await sembrarProducto(principal, `Beta ${sufijo}`, `BET-${sufijo}`, 2000, categoria.id)
    alfa2 = await sembrarProducto(segunda, `Alfa dos ${sufijo}`, `AL2-${sufijo}`, 1000, categoria.id)
    // Beta: escala x10 a 1.500 (el mayorista con 12 unidades la usa).
    await rest('producto_precios_escala', { producto_id: beta.id, organizacion_id: org, escala: 'x10', precio: 1500 }, 'dominio')

    // La persona del panel (administrador): da de alta a los clientes y, después, atiende los presupuestos.
    const correo = `operador-presupuesto-${sufijo}@example.com`
    const id = await altaUsuario(correo)
    await rest('usuarios_organizacion', { user_id: id, organizacion_id: org, rol_id: 'administrador' })
    operador = { correo, id }
    panelToken = await sesionDe(correo, CONTRASENA_E2E)

    mayorista = await sembrarCliente(principal, 'mayorista', { tipo: 'mayorista', descuento: 10 })
    otro = await sembrarCliente(principal, 'otro', { tipo: 'minorista' })
    concurrente = await sembrarCliente(segunda, 'concurrente', { tipo: 'minorista' })
  })

  test.afterAll(async () => {
    if (banderaPrevia !== null) await fijarBandera(banderaPrevia).catch(() => undefined)
    for (const c of clientes) await fetch(`${url}/auth/v1/admin/users/${c.authId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
    if (operador) await borrarUsuario(operador.id)
    if (org) await limpiarOrganizacion(org)
  })

  test('[MSF-176:T061] [B2-1,B2-10,SC-003,SC-006] el mayorista pide el presupuesto desde su lista; el operador lo ve pendiente, lo acepta y no hay stock ni cobros', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await ingresar(page, principal, mayorista)

    // 1) La lista del navegador: 12 de Beta (escala x10) y 1 de Alfa. «Pedir presupuesto» solo existe con cuenta activa.
    await page.goto(`${origen(principal)}/lista`)
    await guardarLista(page, principal, [{ p: beta.id, c: 12 }, { p: alfa.id, c: 1 }])
    await page.reload()
    await expect(page.getByTestId('linea-lista')).toHaveCount(2)
    await expect(page.getByText('Vamos a usar los datos de tu cuenta.')).toBeVisible()
    await page.getByLabel(/^Nota/).fill('Entregar después de las 18 <b>hs</b>')

    // 2) La cotización del servidor: escala x10 (1.500) menos el 10 % de su ficha = 1.350 por 12; Alfa a 1.000 − 10 % = 900; 21 % de IVA. Lo mismo que armaría el panel (paridad en el pgTAP).
    await page.getByRole('button', { name: 'Pedir presupuesto' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Tu presupuesto' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByTestId('presupuesto-subtotal')).toHaveText('$ 17.100,00')
    await expect(dialogo.getByTestId('presupuesto-iva')).toHaveText('$ 3.591,00')
    await expect(dialogo.getByTestId('presupuesto-total')).toHaveText('$ 20.691,00')
    await expect(dialogo.getByText('Es un presupuesto, no una compra: no reserva stock ni se cobra nada.', { exact: false })).toBeVisible()

    // 3) Confirmar: la confirmación con número y total (el mismo de la cotización), con axe y sin desborde a 320 px; la lista se vació.
    await dialogo.getByRole('button', { name: 'Confirmar presupuesto' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Pedimos tu presupuesto Nº 00000001' })).toBeFocused()
    await expect(page.getByText('Es un presupuesto, no una compra: no reserva stock ni se cobró nada. Te vamos a responder para coordinar.')).toBeVisible()
    await expect(page.getByText('Total con IVA: $ 20.691,00')).toBeVisible()
    await expect(page.getByText(/El precio cambió/)).toHaveCount(0)
    expect(await violacionesAxe(page)).toEqual([])
    await page.setViewportSize({ width: 320, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByTestId('indicador-lista')).toHaveAccessibleName('Mi lista, vacía')
    expect(await page.evaluate((clave) => window.localStorage.getItem(clave), claveLista(principal))).toBeNull()

    // 4) En la base: comprobante pendiente, canal tienda_online, sin operador, del cliente de la cuenta, con las líneas del servidor; cero stock y cobros.
    const vinculos = await leer<{ comprobante_id: string; cliente_id: string; empresa_id: string; nota: string | null }>(
      `presupuestos_tienda?select=comprobante_id,cliente_id,empresa_id,nota&organizacion_id=eq.${org}`, 'dominio')
    expect(vinculos).toHaveLength(1)
    expect(vinculos[0]).toMatchObject({ cliente_id: mayorista.clienteId, empresa_id: principal.empresa, nota: 'Entregar después de las 18 <b>hs</b>' })
    const [cabecera] = await leer<{ tipo: string; estado: string; canal: string; operador_id: string | null; valido_hasta: string | null; numero: string; total_con_iva: string }>(
      `comprobantes_venta?select=tipo,estado,canal,operador_id,valido_hasta,numero,total_con_iva&id=eq.${vinculos[0].comprobante_id}`, 'dominio')
    expect(cabecera).toMatchObject({ tipo: 'presupuesto', estado: 'pendiente', canal: 'tienda_online', operador_id: null, valido_hasta: null, numero: '00000001' })
    expect(Number(cabecera.total_con_iva)).toBe(20691)
    const lineas = await leer<{ codigo: string; cantidad: number; precio_unitario: string; escala: string; descuento_pct: string; precio_manual: boolean }>(
      `comprobantes_venta_lineas?select=codigo,cantidad,precio_unitario,escala,descuento_pct,precio_manual&comprobante_id=eq.${vinculos[0].comprobante_id}&order=orden`, 'dominio')
    expect(lineas.map((l) => [l.codigo, l.cantidad, Number(l.precio_unitario), l.escala, Number(l.descuento_pct), l.precio_manual])).toEqual([
      [beta.sku, 12, 1350, 'x10', 10, false],
      [alfa.sku, 1, 900, 'x1', 10, false],
    ])
    const sinEfectos = async () => ({
      movimientos: (await leer<{ id: string }>(`movimientos_stock?select=id&organizacion_id=eq.${org}`, 'dominio')).length,
      reservas: (await leer<{ id: string }>(`reservas_stock?select=id&organizacion_id=eq.${org}`, 'dominio')).length,
      cobros: (await leer<{ id: string }>(`cobros_comprobante?select=id&organizacion_id=eq.${org}`, 'dominio')).length,
    })
    expect(await sinEfectos()).toEqual({ movimientos: 0, reservas: 0, cobros: 0 })

    // 5) «Ver en Mi cuenta»: el presupuesto figura «Pendiente» en Compras y presupuestos.
    await page.getByRole('link', { name: 'Ver en Mi cuenta' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible()
    await expect(page.getByText('Presupuesto').first()).toBeVisible()
    await expect(page.getByText('Pendiente').first()).toBeVisible()

    // 6) El operador: Ventas › Presupuestos con operador «Tienda online (cliente)», la ficha con su rótulo y la nota (literal); lo acepta con el flujo actual y sigue sin stock ni cobros.
    const contextoPanel = await browser.newContext()
    const panel = await contextoPanel.newPage()
    await panel.goto('/login')
    await panel.getByLabel('Correo').fill(operador.correo)
    await panel.getByLabel('Contraseña').fill(CONTRASENA_E2E)
    await panel.getByRole('button', { name: 'Ingresar' }).click()
    await expect(panel).not.toHaveURL(/\/login/)
    await panel.goto('/ventas/presupuestos')
    const fila = panel.getByRole('row', { name: /00000001/ })
    await expect(fila).toContainText('Tienda online (cliente)')
    await expect(fila).toContainText('Pendiente')
    await panel.getByRole('link', { name: '00000001', exact: true }).click()
    await expect(panel.getByText('Creado desde la tienda por el cliente')).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'Operador' })).toHaveValue('Tienda online (cliente)')
    await expect(panel.getByRole('textbox', { name: 'Nota del cliente' })).toHaveValue('Entregar después de las 18 <b>hs</b>')
    await panel.goto('/ventas/presupuestos')
    await panel.getByRole('button', { name: 'Aceptar 00000001' }).click()
    await expect(panel.getByRole('row', { name: /00000001/ })).toContainText('Aceptado')
    expect(await sinEfectos()).toEqual({ movimientos: 0, reservas: 0, cobros: 0 })
    // Actividad: el evento se rotula «Tienda online» (no «Sistema») y nombra al cliente.
    await panel.goto('/actividad')
    const eventoFila = panel.getByRole('row', { name: /Presupuesto pedido desde la tienda/ }).first()
    await expect(eventoFila).toContainText('Tienda online')
    await expect(eventoFila).toContainText('Presupuesto 00000001 pedido desde la tienda')
    await contextoPanel.close()
  })

  test('[MSF-176:T061] [B2-6,B2-8] hasta 5 presupuestos por día: el sexto muestra el aviso, no crea nada y conserva la lista; repetir una clave devuelve el mismo número', async ({ page }) => {
    test.setTimeout(180_000)
    // Ya hay 1 del primer test: 3 más por la API (4 creados hoy) y el quinto por la API también (5); el sexto, por la pantalla.
    const items = [lista(alfa, 1)]
    const claves = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const creados: Respuesta[] = []
    for (const clave of claves) creados.push(await crearPorApi(mayorista, principal, items, clave))
    // El cupo por hora de la tienda es de 5 por visitante: con 1 + 4 se llega al máximo; el tope por cuenta (5 al día) se evalúa ANTES y responde el aviso propio.
    expect(creados.map((c) => c.estado)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(creados.map((c) => c.numero)).toEqual(['00000002', '00000003', '00000004', '00000005'])
    // Idempotencia (B2-8): la misma clave devuelve el MISMO presupuesto y no crea otro.
    const repetida = await crearPorApi(mayorista, principal, items, claves[1])
    expect(repetida).toEqual(creados[1])
    expect((await leer<{ id: string }>(`presupuestos_tienda?select=id&cuenta_cliente_id=not.is.null&organizacion_id=eq.${org}&empresa_id=eq.${principal.empresa}`, 'dominio'))).toHaveLength(5)

    await ingresar(page, principal, mayorista)
    await page.goto(`${origen(principal)}/lista`)
    await guardarLista(page, principal, [{ p: beta.id, c: 2 }])
    await page.reload()
    await page.getByRole('button', { name: 'Pedir presupuesto' }).click()
    const dialogo = page.getByRole('dialog', { name: 'Tu presupuesto' })
    await expect(dialogo.getByTestId('presupuesto-total')).toBeVisible()
    await dialogo.getByRole('button', { name: 'Confirmar presupuesto' }).click()
    await expect(dialogo.getByTestId('resultado-presupuesto')).toContainText('Ya tenés presupuestos abiertos. Esperá nuestra respuesta para pedir otro.')
    await dialogo.getByRole('button', { name: 'Volver a la lista' }).click()
    await expect(page.getByTestId('linea-lista')).toHaveCount(1) // la lista se conserva
    expect((await leer<{ id: string }>(`presupuestos_tienda?select=id&organizacion_id=eq.${org}&empresa_id=eq.${principal.empresa}`, 'dominio'))).toHaveLength(5)
  })

  test('[MSF-176:T061] [B2-7,B2-2,SC-005] dos llamadas simultáneas con 4 creados hoy crean UNA; lo que manda el cliente (cliente_id, precio, descuento, empresa) no cambia nada', async () => {
    test.setTimeout(120_000)
    // «Concurrente» pertenece a la segunda tienda (su cupo por hora es propio). 4 presupuestos de a uno, con claves distintas. Se manda además basura (cliente_id ajeno, precio, descuento, empresa): se ignora.
    const sucio = [{ ...lista(alfa2, 1), cliente_id: otro.clienteId, precio: 1, precio_unitario: 1, descuento: 99, escala: 'x50', empresa_id: principal.empresa, deposito_id: randomUUID(), canal: 'mostrador' }]
    for (let n = 0; n < 4; n += 1) expect((await crearPorApi(concurrente, segunda, sucio, randomUUID())).estado).toBe('ok')
    const [a, b] = await Promise.all([
      crearPorApi(concurrente, segunda, [lista(alfa2, 1)], randomUUID()),
      crearPorApi(concurrente, segunda, [lista(alfa2, 1)], randomUUID()),
    ])
    expect([a.estado, b.estado].sort()).toEqual(['limite_cuenta', 'ok'])
    const vinculos = await leer<{ cliente_id: string; empresa_id: string; comprobante_id: string }>(`presupuestos_tienda?select=cliente_id,empresa_id,comprobante_id&empresa_id=eq.${segunda.empresa}`, 'dominio')
    expect(vinculos).toHaveLength(5)
    expect(vinculos.every((v) => v.cliente_id === concurrente.clienteId && v.empresa_id === segunda.empresa)).toBe(true)
    // El precio es el del servidor (1.000, minorista sin descuento), no el que mandó el cliente.
    const lineas = await leer<{ precio_unitario: string; escala: string; descuento_pct: string }>(`comprobantes_venta_lineas?select=precio_unitario,escala,descuento_pct&comprobante_id=eq.${vinculos[0].comprobante_id}`, 'dominio')
    expect(lineas.map((l) => [Number(l.precio_unitario), l.escala, Number(l.descuento_pct)])).toEqual([[1000, 'x1', 0]])
    // La numeración de la segunda tienda es correlativa (1 a 5, sin saltos ni repetidos).
    const numeros = await leer<{ numero: string }>(`comprobantes_venta?select=numero&empresa_id=eq.${segunda.empresa}&order=numero`, 'dominio')
    expect(numeros.map((n) => n.numero)).toEqual(['00000001', '00000002', '00000003', '00000004', '00000005'])
  })

  test('[MSF-176:T061] [B2-3,B2-4,B2-5,FR-014] sin cuenta, de otra tienda o con la bandera apagada no hay presupuesto: sin_acceso y nada se crea', async () => {
    const antes = (await leer<{ id: string }>(`comprobantes_venta?select=id&organizacion_id=eq.${org}`, 'dominio')).length
    // La cuenta de la tienda principal con el host de la segunda.
    expect((await crearPorApi(otro, segunda, [lista(alfa2, 1)], randomUUID())).estado).toBe('sin_acceso')
    // El anónimo (clave pública, sin sesión) no ejecuta la función.
    const anonimo = await fetch(`${url}/rest/v1/rpc/crear_presupuesto_tienda`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_ANON_KEY ?? '', 'content-type': 'application/json', 'content-profile': 'publico', 'accept-profile': 'publico' },
      body: JSON.stringify({ host: principal.host, items: [lista(alfa, 1)], nota: null, clave_envio: randomUUID() }),
    })
    expect(anonimo.ok).toBe(false)
    // Bandera apagada: sin_acceso aunque la cuenta sea válida.
    await fijarBandera(false)
    try {
      expect((await crearPorApi(otro, principal, [lista(alfa, 1)], randomUUID())).estado).toBe('sin_acceso')
    } finally {
      await fijarBandera(true)
    }
    expect((await leer<{ id: string }>(`comprobantes_venta?select=id&organizacion_id=eq.${org}`, 'dominio')).length).toBe(antes)
  })
})
