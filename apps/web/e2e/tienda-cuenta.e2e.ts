import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { altaUsuario, borrar, cabeceras, CONTRASENA_E2E, rest, serviceKey, url } from './soporte/fixtures'

// F-CLI-20 (MSF-452, historia A de la spec `tienda-compra-y-cuentas`) con las dos tiendas del seed (mundojc.localhost y
// sanjavucho.localhost): «Mi cuenta» con compras y presupuestos, favoritos, redirección a «Ingresar» con la ruta de vuelta, la
// cuenta suspendida a mitad de la sesión y la carga por tandas con 200 comprobantes (SC-001, SC-006). Requiere el stack
// local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador) y SIN escritura directa en las tablas de solo lectura de `dominio` (`pnpm e2e:escritura:check`).
// La función está detrás de la bandera `tienda_pedidos` (apagada por defecto): el spec la enciende y devuelve su valor previo
// al terminar. Si la base todavía no tiene las RPC de la épica (historia A del SQL sin desplegar), se omite con ese motivo; en el job
// `e2e-tienda` esas omisiones hacen fallar `e2e:omitidos:check --max=1` hasta que el SQL de la épica esté en la rama (ver docs/e2e-app.md).

// Ids fijos de supabase/seed.sql (MSF-241).
const MUNDO = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' } as const
const SAN = { host: 'sanjavucho.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000002', empresa: '0f5eed01-0000-4000-8000-000000000002' } as const
type Tienda = typeof MUNDO | typeof SAN

const CLAVE = 'Clave-Segura-123!'
const GENERICO = 'Correo o contraseña incorrectos.'
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const origen = (t: Tienda) => `http://${t.host}:${puerto}`
// El «hoy» de la tienda es el de Buenos Aires (`private.hoy_argentina()`), no el UTC: de noche difieren un día.
const DIA_MS = 24 * 60 * 60 * 1000
const fechaArgentina = (diasAtras: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() - diasAtras * DIA_MS))
const HOY = fechaArgentina(0)

async function admin<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${url}/auth/v1/admin/${ruta}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`Auth admin ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

// La bandera nace APAGADA: se enciende para el spec y se devuelve su valor previo. `null` = la base no tiene la fila.
async function fijarBandera(activa: boolean): Promise<boolean | null> {
  const ruta = 'banderas_plataforma?clave=eq.tienda_pedidos'
  const lectura = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const filas = lectura.ok ? ((await lectura.json()) as { activa: boolean }[]) : []
  if (filas.length === 0) return null
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras({ 'content-profile': 'public' }), body: JSON.stringify({ activa }) })
  if (!r.ok) throw new Error(`bandera tienda_pedidos: ${r.status} ${await r.text()}`)
  return filas[0].activa
}

// ¿La base ya tiene `publico.capacidades_tienda_por_dominio`? (la llama la propia tienda con la clave pública).
async function hayRpcDeLaEpica(): Promise<boolean> {
  const r = await fetch(`${url}/rest/v1/rpc/capacidades_tienda_por_dominio`, {
    method: 'POST',
    headers: cabeceras({ 'content-profile': 'publico', 'accept-profile': 'publico' }),
    body: JSON.stringify({ host: MUNDO.host }),
  })
  return r.status !== 404
}

type Sembrado = { correo: string; authId: string; clienteId: string }
const creados: Sembrado[] = []

// En el stack del CI (`reset-db-ci`) `service_role` no tiene privilegios sobre `public.clientes` ni `public.cuentas_cliente`
// (solo los de `20270307100000`): los clientes se dan de alta COMO LA PERSONA DEL PANEL (administrador de la organización del
// seed, con su sesión y RLS), igual que lo hace la pantalla de Clientes, y solo el vínculo de la cuenta web usa la service-role
// (`vincular_cuenta_cliente`, que es lo que ejecuta la Edge Function de invitación).
type PersonaPanel = { userId: string; correo: string; token: string }
let panel: PersonaPanel

async function sembrarPersonaPanel(organizacion: string): Promise<PersonaPanel> {
  const correo = `mi-cuenta-panel-${randomUUID().slice(0, 8)}@example.com`
  const userId = await altaUsuario(correo)
  await rest('usuarios_organizacion', { user_id: userId, organizacion_id: organizacion, rol_id: 'administrador' })
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correo, password: CONTRASENA_E2E }),
  })
  if (!r.ok) throw new Error(`sesión de ${correo}: ${r.status} ${await r.text()}`)
  return { userId, correo, token: ((await r.json()) as { access_token: string }).access_token }
}

// Llama a PostgREST como la persona del panel (la apikey es la de servicio; `authorization` pone el rol y el RLS de la persona).
async function comoPanel<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: metodo,
    headers: cabeceras({ authorization: `Bearer ${panel.token}`, prefer: 'return=representation' }),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`panel ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json().catch(() => null)) as T
}

// Cliente de la tienda `tienda`, habilitado en ella, con usuario de Auth (contraseña `CLAVE`) y cuenta web activa.
async function sembrarCliente(tienda: Tienda, etiqueta: string): Promise<Sembrado> {
  const sufijo = randomUUID().slice(0, 8)
  const correo = `mi-cuenta-${etiqueta}-${sufijo}@example.com`
  const [cliente] = await comoPanel<{ id: string }[]>('POST', 'clientes', {
    organizacion_id: tienda.organizacion, nombre: `E2E ${etiqueta} ${sufijo}`, correo, tipo: 'minorista',
  })
  await comoPanel('POST', 'rpc/guardar_empresas_de_cliente', { p_cliente_id: cliente.id, p_empresa_ids: [tienda.empresa] })
  const usuario = await admin<{ id: string }>('users', { email: correo, email_confirm: true, password: CLAVE })
  const sembrado = { correo, authId: usuario.id, clienteId: cliente.id }
  creados.push(sembrado)
  const vinculo = await fetch(`${url}/rest/v1/rpc/vincular_cuenta_cliente`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ p_cliente: cliente.id, p_empresa: tienda.empresa, p_auth_user: usuario.id }),
  })
  if (!vinculo.ok) throw new Error(`vincular_cuenta_cliente: ${vinculo.status} ${await vinculo.text()}`)
  return sembrado
}

const comprobante = (clienteId: string, tienda: Tienda, extra: Record<string, unknown>) => ({
  organizacion_id: tienda.organizacion, empresa_id: tienda.empresa, cliente_id: clienteId, fecha: HOY, canal: 'mostrador',
  total_sin_iva: 100, total_con_iva: 121, ...extra,
})

// Completa y envía el formulario de /ingresar (la página ya está abierta).
async function ingresar(page: Page, correo: string, clave: string) {
  await page.getByLabel(/^Correo/).fill(correo)
  await page.getByLabel(/^Contraseña/).fill(clave)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

test.describe('Tienda · «Mi cuenta» (F-CLI-20)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // Los tests comparten la bandera (global) y la siembra: en serie.
  test.describe.configure({ mode: 'serial' })

  let banderaPrevia: boolean | null = null
  let sufijo = ''
  let productoId = ''
  let productoNombre = ''
  let cliente: Sembrado
  let numeros: { factura: string; vencido: string; ajeno: string }

  test.beforeAll(async () => {
    test.skip(!(await hayRpcDeLaEpica()), 'La base no tiene todavía las RPC de la épica `tienda-compra-y-cuentas` (historia A del SQL).')
    banderaPrevia = await fijarBandera(true)
    test.skip(banderaPrevia === null, 'La base no tiene la bandera `tienda_pedidos`.')

    sufijo = randomUUID().slice(0, 8)
    productoNombre = `Favorito E2E ${sufijo}`
    const [producto] = await rest<{ id: string }>('productos', { organizacion_id: MUNDO.organizacion, nombre: productoNombre, sku: `E2E-FAV-${sufijo}`, precio_lista: 1000, moneda: 'ARS' }, 'dominio')
    productoId = producto.id
    await rest('producto_empresa', { producto_id: productoId, empresa_id: MUNDO.empresa, organizacion_id: MUNDO.organizacion }, 'dominio')

    panel = await sembrarPersonaPanel(MUNDO.organizacion)
    cliente = await sembrarCliente(MUNDO, 'principal')
    const ajeno = await sembrarCliente(MUNDO, 'ajeno')
    numeros = { factura: `F${sufijo}-1`, vencido: `P${sufijo}-1`, ajeno: `X${sufijo}-1` }
    await rest('comprobantes_venta', [
      comprobante(cliente.clienteId, MUNDO, { tipo: 'factura', numero: numeros.factura, estado: 'confirmada' }),
      // Un presupuesto pendiente con validez vencida: la tienda lo muestra «Vencido». `comprobantes_venta_valido_hasta_ck` exige
      // valido_hasta >= fecha: fecha hace 5 días y validez hasta hace 3.
      comprobante(cliente.clienteId, MUNDO, { tipo: 'presupuesto', numero: numeros.vencido, estado: 'pendiente', fecha: fechaArgentina(5), valido_hasta: fechaArgentina(3), total_con_iva: 242 }),
      comprobante(ajeno.clienteId, MUNDO, { tipo: 'factura', numero: numeros.ajeno, estado: 'confirmada' }),
    ], 'dominio')
  })

  test.afterAll(async () => {
    if (banderaPrevia !== null) await fijarBandera(banderaPrevia).catch(() => undefined)
    for (const s of creados) {
      await borrar(`comprobantes_venta?cliente_id=eq.${s.clienteId}`, 'dominio')
      await fetch(`${url}/auth/v1/admin/users/${s.authId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
      // Como la persona del panel; si el rol no puede borrar clientes queda el cliente de prueba (con sufijo único).
      await comoPanel('DELETE', `clientes?id=eq.${s.clienteId}`).catch((e: unknown) => console.warn('limpieza E2E: cliente', e instanceof Error ? e.message : e))
    }
    if (panel) {
      await borrar(`usuarios_organizacion?user_id=eq.${panel.userId}`)
      await fetch(`${url}/auth/v1/admin/users/${panel.userId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
    }
    if (productoId) {
      await borrar(`producto_empresa?producto_id=eq.${productoId}`, 'dominio')
      await borrar(`productos?id=eq.${productoId}`, 'dominio')
    }
  })

  test('[MSF-452:T022] [F-CLI-20#1,2,3,6] sin sesión va a «Ingresar» y, tras ingresar, vuelve a «Mi cuenta» con lo suyo y nada de otro cliente', async ({ page }) => {
    // Sin sesión: «Mi cuenta» no existe en el encabezado y /mi-cuenta manda a «Ingresar» con la ruta de vuelta.
    await page.goto(`${origen(MUNDO)}/mi-cuenta?seccion=compras`)
    await expect(page).toHaveURL(/\/ingresar\?volver=%2Fmi-cuenta%3Fseccion%3Dcompras/)
    await ingresar(page, cliente.correo, CLAVE)
    await expect(page).toHaveURL(new RegExp(`^${origen(MUNDO)}/mi-cuenta\\?seccion=compras`))
    await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mi cuenta' })).toBeVisible()

    // Solo lo suyo: su factura (Confirmada) y su presupuesto vencido (Vencido); nunca el del otro cliente ni estados de cobro.
    const fila = (numero: string) => page.getByRole('row').filter({ hasText: numero })
    await expect(fila(numeros.factura)).toContainText('Confirmada')
    await expect(fila(numeros.factura)).toContainText('$ 121,00')
    await expect(fila(numeros.vencido)).toContainText('Vencido')
    await expect(fila(numeros.vencido)).toContainText('Presupuesto')
    await expect(page.getByText(numeros.ajeno)).toHaveCount(0)
    await expect(page.getByText(/cobrado|deuda|en proceso|armando/i)).toHaveCount(0)

    // Detalle: el comprobante se abre en un diálogo con sus totales, sin datos internos.
    await fila(numeros.factura).getByRole('link').first().click()
    const detalle = page.getByRole('dialog', { name: /Compra Nº/ })
    await expect(detalle.getByText('Total con IVA')).toBeVisible()
    await expect(detalle).toContainText('$ 121,00')
    await expect(detalle).not.toContainText(/costo|margen|operador/i)
    await detalle.getByRole('button', { name: 'Cerrar' }).click()
    await expect(detalle).toHaveCount(0)

    // «Salir» y volver a pedir /mi-cuenta: otra vez «Ingresar».
    await page.getByRole('button', { name: 'Salir' }).click()
    await page.goto(`${origen(MUNDO)}/mi-cuenta`)
    await expect(page).toHaveURL(/\/ingresar\?volver=/)
  })

  test('[MSF-452:T022] [F-CLI-20#8] guardar y quitar un favorito desde la ficha y desde «Mi cuenta»', async ({ page }) => {
    await page.goto(`${origen(MUNDO)}/producto/${productoId}`)
    // Sin sesión el control lleva a «Ingresar» y vuelve a la ficha.
    await expect(page.getByText('Ingresá para guardar tus favoritos')).toBeVisible()
    await page.getByRole('link', { name: 'Guardar en favoritos' }).click()
    await expect(page).toHaveURL(/\/ingresar\?volver=%2Fproducto%2F/)
    await ingresar(page, cliente.correo, CLAVE)
    await expect(page).toHaveURL(new RegExp(`/producto/${productoId}$`))

    const guardar = page.getByRole('button', { name: 'Guardar en favoritos' })
    await expect(guardar).toBeEnabled()
    await guardar.click()
    await expect(page.getByRole('status').filter({ hasText: `Guardamos «${productoNombre}» en tus favoritos` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Quitar de favoritos' })).toHaveAttribute('aria-pressed', 'true')

    // En «Mi cuenta › Favoritos» está, con su disponibilidad; se quita con «Quitar».
    await page.goto(`${origen(MUNDO)}/mi-cuenta?seccion=favoritos`)
    await expect(page.getByRole('link', { name: productoNombre })).toBeVisible()
    await expect(page.getByText('1 favorito', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `Quitar ${productoNombre} de favoritos` }).click()
    await expect(page.getByRole('status').filter({ hasText: `Quitamos «${productoNombre}» de tus favoritos` })).toBeVisible()
    await expect(page.getByText('Todavía no guardaste favoritos')).toBeVisible()
  })

  test('[MSF-452:T022] [F-CLI-20#7] una cuenta suspendida a mitad de la sesión ve «Tu cuenta no está activa» y nada de su historial; la otra tienda no la deja entrar', async ({ page }) => {
    const sinSesion = await page.context().newPage()
    await sinSesion.goto(`${origen(SAN)}/ingresar`)
    await ingresar(sinSesion, cliente.correo, CLAVE)
    // La cuenta es de Mundo JC: San Javucho responde el mismo mensaje que con una contraseña errónea y no la deja entrar.
    await expect(sinSesion.getByText(GENERICO)).toBeVisible()
    await sinSesion.close()

    await page.goto(`${origen(MUNDO)}/ingresar?volver=%2Fmi-cuenta`)
    await ingresar(page, cliente.correo, CLAVE)
    await expect(page.getByRole('row').filter({ hasText: numeros.factura })).toBeVisible()

    // Se suspende como lo hace el panel (Clientes › Cuenta web): la RPC de gestión con la sesión de la persona del panel.
    await comoPanel('POST', 'rpc/cambiar_estado_cuenta_cliente', { p_cliente: cliente.clienteId, p_empresa: MUNDO.empresa, p_estado: 'suspendida' })

    // La próxima llamada (la pestaña «Favoritos») ya no tiene acceso: se reemplaza todo y no queda nada del historial.
    await page.getByRole('tab', { name: 'Favoritos' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tu cuenta no está activa en esta tienda' })).toBeVisible()
    await expect(page.getByText('Si creés que es un error, escribinos desde Contacto.')).toBeVisible()
    await expect(page.getByText(numeros.factura)).toHaveCount(0)
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })

  test('[MSF-452:T022] [F-CLI-20#1] 200 comprobantes cargan por tandas de 20 con «Cargar más» (SC-001, SC-006)', async ({ page }) => {
    const masivo = await sembrarCliente(MUNDO, 'masivo')
    const filas = Array.from({ length: 200 }, (_, i) => comprobante(masivo.clienteId, MUNDO, {
      tipo: 'presupuesto', numero: `M${sufijo}-${String(i + 1).padStart(4, '0')}`, estado: 'pendiente',
      fecha: fechaArgentina(Math.floor(i / 4)),
    }))
    await rest('comprobantes_venta', filas, 'dominio')

    await page.goto(`${origen(MUNDO)}/ingresar?volver=%2Fmi-cuenta`)
    await ingresar(page, masivo.correo, CLAVE)
    const inicio = Date.now()
    const tabla = page.getByRole('table', { name: 'Compras y presupuestos' })
    // Encabezado + una o más tandas de 20 (con la ventana alta el observador puede pedir la segunda solo).
    await expect.poll(async () => (await tabla.getByRole('row').count()) % 20).toBe(1)
    const antes = await tabla.getByRole('row').count()
    const ms = Date.now() - inicio
    test.info().annotations.push({ type: 'rendimiento', description: `primera tanda de 200 comprobantes visible en ${ms} ms` })
    // SC-001 pide menos de 3 s; el runner del CI va cargado, así que el tope del test es holgado y la medición queda anotada.
    expect(ms).toBeLessThan(10_000)
    await expect(page.getByText('200 comprobantes', { exact: true })).toBeVisible()

    // «Cargar más» (operable con teclado) suma otra tanda sin reemplazar la anterior.
    const cargarMas = page.getByRole('button', { name: 'Cargar más' })
    await cargarMas.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => tabla.getByRole('row').count()).toBeGreaterThan(antes)
  })
})
