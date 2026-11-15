import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { altaUsuario, borrarUsuario, cabeceras, CONTRASENA_E2E, leer, limpiarOrganizacion, rest, serviceKey, url } from './soporte/fixtures'

// MSF-176 · historia B1 «Lista de pedido sin cobro» (T043; SC-002): un visitante agrega 3 productos desde sus fichas, abre «Mi lista», la envía sin pagar y el operador la
// ve en la bandeja de Consultas como «Pedido» con los 3 ítems (y el aviso por correo emitido); el sexto envío de la hora muestra el aviso de límite; el HTML escrito queda
// literal. Con tienda, producto y personas PROPIOS de la corrida (la baja de la organización se lleva todo): así el cupo de envíos por visitante no se comparte con otros specs.
// Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`) y la web servida; siembra con la API admin desde Node (la service-role key nunca llega al
// navegador) y SIN escritura directa en las tablas de solo lectura de `dominio` (`pnpm e2e:escritura:check`): las consultas entran por la RPC pública de la propia tienda.
// La función está detrás de la bandera `tienda_pedidos` (apagada por defecto): el spec la enciende y devuelve su valor previo al terminar. Si la base todavía no tiene las
// RPC de la historia B1, se omite con ese motivo; en el job `e2e-tienda` esa omisión hace fallar `e2e:omitidos:check --max=1`.

const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

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

// ¿La base ya tiene `publico.enviar_lista_pedido`? (la llama la propia tienda con la clave pública).
async function hayRpcDeB1(): Promise<boolean> {
  const r = await fetch(`${url}/rest/v1/rpc/enviar_lista_pedido`, {
    method: 'POST',
    headers: cabeceras({ 'content-profile': 'publico', 'accept-profile': 'publico' }),
    body: JSON.stringify({ host: 'sin-tienda.localhost', nombre: 'x', contacto: 'x@example.com', nota: null, items: [], clave_envio: randomUUID() }),
  })
  return r.status !== 404
}

type Producto = { id: string; nombre: string; sku: string }
type ConsultaFila = { id: string; origen: string; nombre: string; contacto: string; mensaje: string | null; empresa_id: string; cliente_id: string | null }
type ItemFila = { orden: number; descripcion: string; sku: string | null; cantidad: number; precio_referencia: number | null }

test.describe('Tienda · lista de pedido sin cobro (B1)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // Los tests comparten la bandera (global) y la siembra: en serie.
  test.describe.configure({ mode: 'serial' })

  let banderaPrevia: boolean | null = null
  let sufijo = ''
  let org = ''
  let empresa = ''
  let host = ''
  let origen = ''
  let operador: { correo: string; id: string }
  const productos: Producto[] = []

  test.beforeAll(async () => {
    test.skip(!(await hayRpcDeB1()), 'La base no tiene todavía las RPC de la historia B1 de `tienda-compra-y-cuentas`.')
    banderaPrevia = await fijarBandera(true)
    test.skip(banderaPrevia === null, 'La base no tiene la bandera `tienda_pedidos`.')

    sufijo = randomUUID().slice(0, 8)
    const [organizacion] = await rest<{ id: string }>('organizaciones', { nombre: `E2E lista ${sufijo}` })
    org = organizacion.id
    const [emp] = await rest<{ id: string }>('empresas', { organizacion_id: org, nombre: `Tienda Lista ${sufijo}` }, 'dominio')
    empresa = emp.id
    host = `lista-${sufijo}.localhost`
    origen = `http://${host}:${puerto}`
    await rest('tiendas', { organizacion_id: org, empresa_id: empresa, dominio: host }, 'dominio')
    for (const n of [1, 2, 3]) {
      const nombre = `Producto lista ${n} ${sufijo}`
      const sku = `LST-${n}-${sufijo}`
      const [producto] = await rest<{ id: string }>('productos', { organizacion_id: org, nombre, sku, precio_lista: 1000 * n, moneda: 'ARS' }, 'dominio')
      await rest('producto_empresa', { producto_id: producto.id, empresa_id: empresa, organizacion_id: org }, 'dominio')
      productos.push({ id: producto.id, nombre, sku })
    }
    // La persona del panel que atiende las consultas de esa organización (administrador: todo y todas las empresas).
    const correo = `operador-lista-${sufijo}@example.com`
    const id = await altaUsuario(correo)
    await rest('usuarios_organizacion', { user_id: id, organizacion_id: org, rol_id: 'administrador' })
    operador = { correo, id }
  })

  test.afterAll(async () => {
    if (banderaPrevia !== null) await fijarBandera(banderaPrevia).catch(() => undefined)
    if (operador) await borrarUsuario(operador.id)
    if (org) await limpiarOrganizacion(org)
  })

  // Lista del navegador por tienda (lo mismo que escribe el botón «Agregar a la lista»): solo producto_id y cantidad. La tienda la guarda por `window.location.host`
  // (con el puerto, si lo hay).
  const claveLista = () => `msf.lista-pedido.v1:${puerto ? `${host}:${puerto}` : host}`
  const guardarLista = (page: Page, lineas: Array<{ p: string; c: number }>) =>
    page.evaluate(([clave, valor]) => window.localStorage.setItem(clave, valor), [claveLista(), JSON.stringify(lineas)] as const)

  async function llenarYEnviar(page: Page, nombre: string, nota = '') {
    await page.getByLabel(/^Nombre/).fill(nombre)
    await page.getByLabel(/^Correo o teléfono/).fill('visitante@example.com')
    if (nota) await page.getByLabel(/^Nota/).fill(nota)
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
  }

  test('[MSF-176:T043] [B1-1,B1-9,SC-002] un visitante arma su lista desde las fichas, la envía sin pagar y el operador la ve como «Pedido» con los 3 ítems', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const visitante = `Visitante lista ${sufijo}`

    // 1) Agregar 3 productos desde sus fichas: «Agregar a la lista» y el indicador del encabezado.
    for (const [indice, producto] of productos.entries()) {
      await page.goto(`${origen}/producto/${producto.id}`)
      await expect(page.getByRole('heading', { level: 1, name: producto.nombre })).toBeVisible()
      await page.getByRole('button', { name: 'Agregar a la lista' }).click()
      await expect(page.getByRole('status').filter({ hasText: `Agregamos «${producto.nombre}» a tu lista` })).toBeVisible()
      await expect(page.getByTestId('indicador-lista')).toHaveAccessibleName(`Mi lista, ${indice + 1} ${indice === 0 ? 'producto' : 'productos'}`)
    }
    await expect(page.getByText('Ya tenés 1 en tu lista')).toBeVisible()

    // 2) Abrir la lista desde el encabezado: las 3 líneas, la leyenda fija y un total de referencia que suma los 3 precios.
    await page.getByTestId('indicador-lista').click()
    await expect(page).toHaveURL(`${origen}/lista`)
    await expect(page.getByRole('heading', { level: 1, name: 'Mi lista de pedido' })).toBeVisible()
    await expect(page.getByText('Precios de referencia: se confirman al responder. Este pedido no reserva stock ni es una compra.')).toBeVisible()
    await expect(page.getByTestId('linea-lista')).toHaveCount(3)
    await expect(page.getByTestId('total-referencia')).toHaveText('$ 6.000')
    // Sin desborde horizontal a 320 px (FR-033).
    await page.setViewportSize({ width: 320, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 1280, height: 800 })

    // 3) Sin completar nada no se envía; después se envía con una nota con HTML, que queda literal.
    await page.getByRole('button', { name: 'Enviar pedido' }).click()
    await expect(page.getByText('Ingresá tu nombre.')).toBeVisible()
    await expect(page.getByLabel(/^Nombre/)).toBeFocused()
    await llenarYEnviar(page, visitante, '<script>window.__xss = 1</script><b>negrita</b>')
    await expect(page.getByRole('heading', { level: 1, name: 'Recibimos tu pedido' })).toBeFocused()
    await expect(page.getByText('Te vamos a responder para confirmar disponibilidad y precio. No se cobró nada.')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
    // La lista se vació: el indicador vuelve a «Mi lista» y el almacenamiento no guarda nada.
    await expect(page.getByTestId('indicador-lista')).toHaveAccessibleName('Mi lista, vacía')
    expect(await page.evaluate((clave) => window.localStorage.getItem(clave), claveLista())).toBeNull()

    // 4) En la base: UNA consulta de origen pedido con sus 3 ítems (descripción, SKU, cantidad y precio de referencia del servidor).
    const consultas = await leer<ConsultaFila>(`consultas?select=id,origen,nombre,contacto,mensaje,empresa_id,cliente_id&nombre=eq.${encodeURIComponent(visitante)}`, 'dominio')
    expect(consultas).toHaveLength(1)
    expect(consultas[0]).toMatchObject({ origen: 'pedido', empresa_id: empresa, contacto: 'visitante@example.com', cliente_id: null, mensaje: '<script>window.__xss = 1</script><b>negrita</b>' })
    const items = await leer<ItemFila>(`consulta_items?select=orden,descripcion,sku,cantidad,precio_referencia&consulta_id=eq.${consultas[0].id}&order=orden`, 'dominio')
    expect(items.map((item) => [item.descripcion, item.sku, item.cantidad, Number(item.precio_referencia)])).toEqual(
      productos.map((producto, indice) => [producto.nombre, producto.sku, 1, 1000 * (indice + 1)]),
    )
    // (El aviso por correo con el resumen de los ítems lo prueba el pgTAP `tienda_lista_pedido`: en el stack del CI ni `service_role` ni `authenticated` leen `public.avisos_pendientes` por la API.)

    // 5) El operador la ve en la bandeja de Consultas: origen «Pedido», «Pedido de 3 productos» y, en el detalle, los 3 ítems; el HTML de la nota se ve literal.
    const contextoPanel = await browser.newContext()
    const panel = await contextoPanel.newPage()
    await panel.goto('/login')
    await panel.getByLabel('Correo').fill(operador.correo)
    await panel.getByLabel('Contraseña').fill(CONTRASENA_E2E)
    await panel.getByRole('button', { name: 'Ingresar' }).click()
    await expect(panel).not.toHaveURL(/\/login/)
    await panel.goto(`/consultas?consulta=${consultas[0].id}`)
    const detalle = panel.getByRole('dialog', { name: `Consulta de ${visitante}` })
    await expect(detalle).toBeVisible()
    await expect(detalle.getByText('Pedido', { exact: true }).first()).toBeVisible()
    const filas = detalle.getByTestId('bloque-pedido').getByRole('row')
    await expect(filas).toHaveCount(4) // encabezado + 3 ítems
    for (const producto of productos) await expect(detalle.getByTestId('bloque-pedido')).toContainText(producto.nombre)
    await expect(detalle.getByTestId('total-referencia-pedido')).toContainText('Total de referencia $ 6.000,00')
    await expect(detalle.getByText('Nota de la persona')).toBeVisible()
    await expect(detalle.getByText('<script>window.__xss = 1</script><b>negrita</b>')).toBeVisible()
    expect(await panel.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
    await detalle.getByRole('button', { name: 'Cerrar' }).first().click()
    await expect(panel.getByRole('row', { name: new RegExp(visitante) })).toContainText('Pedido de 3 productos')
    await contextoPanel.close()
  })

  test('[MSF-176:T043] [B1-3,B1-10] el sexto envío de la hora muestra el aviso de límite y conserva la lista; con el almacenamiento bloqueado la lista funciona en memoria', async ({ page }) => {
    test.setTimeout(120_000)
    // Ya hay 1 envío de este visitante en la hora (el primer test): 4 más salen y el sexto se rechaza.
    await page.goto(`${origen}/lista`)
    for (const n of [2, 3, 4, 5]) {
      await guardarLista(page, [{ p: productos[0].id, c: n }])
      await page.reload()
      await expect(page.getByTestId('linea-lista')).toHaveCount(1)
      await llenarYEnviar(page, `Visitante lista ${sufijo} envío ${n}`)
      await expect(page.getByRole('heading', { level: 1, name: 'Recibimos tu pedido' })).toBeVisible()
    }
    await guardarLista(page, [{ p: productos[0].id, c: 6 }])
    await page.reload()
    await expect(page.getByTestId('linea-lista')).toHaveCount(1)
    await llenarYEnviar(page, `Visitante lista ${sufijo} envío 6`)
    await expect(page.getByTestId('aviso-limite')).toContainText('Hiciste varios envíos seguidos. Probá de nuevo en')
    await expect(page.getByTestId('linea-lista')).toHaveCount(1) // la lista se conserva
    await expect(page.getByLabel(/^Nombre/)).toHaveValue(`Visitante lista ${sufijo} envío 6`)

    // La base recibió 5 (el del primer test y cuatro de acá), todos de SU empresa; el sexto no.
    const pedidos = await leer<{ nombre: string }>(`consultas?select=nombre&origen=eq.pedido&empresa_id=eq.${empresa}`, 'dominio')
    expect(pedidos).toHaveLength(5)
    expect(pedidos.some((c) => c.nombre.endsWith('envío 6'))).toBe(false)

    // Navegador que bloquea el almacenamiento (B1-10): la lista funciona en memoria y avisa que no se conservará.
    const bloqueado = await page.context().newPage()
    await bloqueado.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError') } })
    })
    await bloqueado.goto(`${origen}/producto/${productos[1].id}`)
    await bloqueado.getByRole('button', { name: 'Agregar a la lista' }).click()
    await expect(bloqueado.getByTestId('indicador-lista')).toHaveAccessibleName('Mi lista, 1 producto')
    await bloqueado.getByRole('link', { name: 'Ver lista' }).click()
    await expect(bloqueado.getByText('Tu navegador no nos deja guardar la lista: se conserva mientras no cierres esta página.')).toBeVisible()
    await expect(bloqueado.getByTestId('linea-lista')).toHaveCount(1)
    await bloqueado.close()
  })

  test('[MSF-176:T043] [FR-014] con la bandera apagada la tienda no muestra nada de la lista y /lista es la 404', async ({ page }) => {
    await fijarBandera(false)
    try {
      await page.goto(`${origen}/producto/${productos[0].id}`)
      await expect(page.getByRole('heading', { level: 1, name: productos[0].nombre })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Agregar a la lista' })).toHaveCount(0)
      await expect(page.getByTestId('indicador-lista')).toHaveCount(0)
      await page.goto(`${origen}/lista`)
      await expect(page.getByTestId('pagina-no-encontrada')).toBeVisible()
    } finally {
      await fijarBandera(true)
    }
  })
})
