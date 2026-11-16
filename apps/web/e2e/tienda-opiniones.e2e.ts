import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { altaUsuario, borrar, cabeceras, CONTRASENA_E2E, leer, rest, serviceKey, url } from './soporte/fixtures'

// Opiniones de productos (spec `opiniones-de-productos`, T027): un cliente con cuenta web opina desde la ficha → la opinión queda
// pendiente y no se ve → el administrador la acepta → se ve con su promedio → el cliente la edita → vuelve a pendiente y desaparece
// de la ficha → el cliente la borra desde «Mis opiniones». Requiere el stack local (`pnpm dev:supabase`, que aplica `supabase/seed.sql`)
// y la web servida; siembra con la API admin desde Node (la service-role key nunca llega al navegador) y SIN escritura directa en las
// tablas de solo lectura de `dominio` (`pnpm e2e:escritura:check`): el cliente y su cuenta entran como lo hace el panel y la
// moderación la hace la persona administradora con su sesión (RPC `moderar_opinion`). Se omite sin `SUPABASE_URL` /
// `SUPABASE_SERVICE_ROLE_KEY` o si la base todavía no tiene las RPC de opiniones. La función está detrás de la bandera
// `tienda_opiniones` (apagada por defecto): el spec la enciende, junto con `tienda_pedidos` (que habilita «Mi cuenta»), y devuelve sus valores previos al terminar.

// Ids fijos de supabase/seed.sql.
const MUNDO = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' } as const
const CLAVE = 'Clave-Segura-123!'
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const origen = `http://${MUNDO.host}:${puerto}`

async function admin<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const r = await fetch(`${url}/auth/v1/admin/${ruta}`, { method: 'POST', headers: cabeceras(), body: JSON.stringify(cuerpo) })
  if (!r.ok) throw new Error(`Auth admin ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

// La bandera nace APAGADA: se enciende para el spec y se devuelve su valor previo. `null` = la base no tiene la fila.
async function fijarBandera(clave: 'tienda_opiniones' | 'tienda_pedidos', activa: boolean): Promise<boolean | null> {
  const ruta = `banderas_plataforma?clave=eq.${clave}`
  const lectura = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  const filas = lectura.ok ? ((await lectura.json()) as { activa: boolean }[]) : []
  if (filas.length === 0) return null
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras({ 'content-profile': 'public' }), body: JSON.stringify({ activa }) })
  if (!r.ok) throw new Error(`bandera ${clave}: ${r.status} ${await r.text()}`)
  return filas[0].activa
}

// ¿La base ya tiene `publico.capacidades_opiniones_por_dominio`? (la llama la propia tienda con la clave pública).
async function hayRpcDeOpiniones(): Promise<boolean> {
  const r = await fetch(`${url}/rest/v1/rpc/capacidades_opiniones_por_dominio`, {
    method: 'POST',
    headers: cabeceras({ 'content-profile': 'publico', 'accept-profile': 'publico' }),
    body: JSON.stringify({ host: MUNDO.host }),
  })
  return r.status !== 404
}

type PersonaPanel = { userId: string; correo: string; token: string }
type OpinionFila = { id: string; estado: string; puntuacion: number; comentario: string; actualizada_en: string }

test.describe('Tienda · opiniones de productos', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // Los tests comparten la bandera (global) y la siembra: en serie.
  test.describe.configure({ mode: 'serial' })

  let banderaPrevia: boolean | null = null
  let pedidosPrevia: boolean | null = null
  let sufijo = ''
  let productoId = ''
  let productoNombre = ''
  let panel: PersonaPanel
  let cliente: { correo: string; authId: string; clienteId: string }

  // Llama a PostgREST como la persona administradora (apikey de servicio; `authorization` pone el rol y el RLS de la persona).
  async function comoPanel<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await fetch(`${url}/rest/v1/${ruta}`, {
      method: metodo,
      // `clientes` vive en `dominio` (PostgREST elige el esquema por el perfil).
      headers: cabeceras({
        authorization: `Bearer ${panel.token}`,
        prefer: 'return=representation',
        ...(/^clientes(\?|$)/.test(ruta) ? { 'accept-profile': 'dominio', 'content-profile': 'dominio' } : {}),
      }),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    if (!r.ok) throw new Error(`panel ${metodo} ${ruta}: ${r.status} ${await r.text()}`)
    return (await r.json().catch(() => null)) as T
  }

  const leerOpiniones = () => leer<OpinionFila>(`opiniones_producto?select=id,estado,puntuacion,comentario,actualizada_en&producto_id=eq.${productoId}`, 'dominio')

  async function moderar(decision: 'aceptar' | 'rechazar') {
    const [opinion] = await leerOpiniones()
    await comoPanel('POST', 'rpc/moderar_opinion', { p_id: opinion.id, p_decision: decision, p_motivo: null, p_actualizada_en_esperada: opinion.actualizada_en })
  }

  test.beforeAll(async () => {
    test.skip(!(await hayRpcDeOpiniones()), 'La base no tiene todavía las RPC de opiniones de productos.')
    banderaPrevia = await fijarBandera('tienda_opiniones', true)
    // «Mi cuenta» (y su pestaña «Mis opiniones») existe solo con la función de cuentas encendida.
    pedidosPrevia = await fijarBandera('tienda_pedidos', true)
    test.skip(banderaPrevia === null, 'La base no tiene la bandera `tienda_opiniones`.')

    sufijo = randomUUID().slice(0, 8)
    productoNombre = `Opinión E2E ${sufijo}`
    const [producto] = await rest<{ id: string }>('productos', { organizacion_id: MUNDO.organizacion, nombre: productoNombre, sku: `E2E-OPI-${sufijo}`, precio_lista: 1000, moneda: 'ARS' }, 'dominio')
    productoId = producto.id
    await rest('producto_empresa', { producto_id: productoId, empresa_id: MUNDO.empresa, organizacion_id: MUNDO.organizacion }, 'dominio')

    // La persona administradora (moderación y alta del cliente, con su sesión y RLS).
    const correoPanel = `opiniones-panel-${sufijo}@example.com`
    const userId = await altaUsuario(correoPanel)
    await rest('usuarios_organizacion', { user_id: userId, organizacion_id: MUNDO.organizacion, rol_id: 'administrador' })
    const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ email: correoPanel, password: CONTRASENA_E2E }) })
    if (!sesion.ok) throw new Error(`sesión de ${correoPanel}: ${sesion.status} ${await sesion.text()}`)
    panel = { userId, correo: correoPanel, token: ((await sesion.json()) as { access_token: string }).access_token }

    // Cliente habilitado en la tienda, con usuario de Auth y cuenta web activa.
    const correo = `opiniones-${sufijo}@example.com`
    const [fila] = await comoPanel<{ id: string }[]>('POST', 'clientes', { organizacion_id: MUNDO.organizacion, nombre: `Valeria E2E${sufijo}`, correo, tipo: 'minorista' })
    await comoPanel('POST', 'rpc/guardar_empresas_de_cliente', { p_cliente_id: fila.id, p_empresa_ids: [MUNDO.empresa] })
    const usuario = await admin<{ id: string }>('users', { email: correo, email_confirm: true, password: CLAVE })
    cliente = { correo, authId: usuario.id, clienteId: fila.id }
    const vinculo = await fetch(`${url}/rest/v1/rpc/vincular_cuenta_cliente`, {
      method: 'POST', headers: cabeceras(), body: JSON.stringify({ p_cliente: fila.id, p_empresa: MUNDO.empresa, p_auth_user: usuario.id }),
    })
    if (!vinculo.ok) throw new Error(`vincular_cuenta_cliente: ${vinculo.status} ${await vinculo.text()}`)
  })

  test.afterAll(async () => {
    if (banderaPrevia !== null) await fijarBandera('tienda_opiniones', banderaPrevia).catch(() => undefined)
    if (pedidosPrevia !== null) await fijarBandera('tienda_pedidos', pedidosPrevia).catch(() => undefined)
    if (productoId) {
      await borrar(`opiniones_producto?producto_id=eq.${productoId}`, 'dominio')
      await borrar(`producto_empresa?producto_id=eq.${productoId}`, 'dominio')
      await borrar(`productos?id=eq.${productoId}`, 'dominio')
    }
    if (cliente) {
      await fetch(`${url}/auth/v1/admin/users/${cliente.authId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
      await comoPanel('DELETE', `clientes?id=eq.${cliente.clienteId}`).catch((e: unknown) => console.warn('limpieza E2E: cliente', e instanceof Error ? e.message : e))
    }
    if (panel) {
      await borrar(`usuarios_organizacion?user_id=eq.${panel.userId}`)
      await fetch(`${url}/auth/v1/admin/users/${panel.userId}`, { method: 'DELETE', headers: cabeceras() }).catch(() => undefined)
    }
  })

  async function ingresar(page: Page) {
    await page.goto(`${origen}/ingresar?volver=${encodeURIComponent(`/producto/${productoId}`)}`)
    await page.getByLabel(/^Correo/).fill(cliente.correo)
    await page.getByLabel(/^Contraseña/).fill(CLAVE)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL(`${origen}/producto/${productoId}`)
  }

  test('opinar → no se ve → aceptar → se ve con promedio → editar → se oculta → borrar', async ({ page, browser }) => {
    test.setTimeout(180_000)

    // 1) Sin sesión se ve el bloque con la invitación a ingresar y «Todavía no hay opiniones».
    await page.goto(`${origen}/producto/${productoId}`)
    await expect(page.getByRole('heading', { level: 2, name: 'Opiniones' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ingresá para dejar tu opinión' })).toBeVisible()

    // 2) Con sesión, el cliente opina: el mensaje dice que se publicará cuando la revisen.
    await ingresar(page)
    await page.getByRole('radio', { name: '4 estrellas de 5' }).click()
    await page.getByLabel(/^Tu comentario/).fill('Muy buen producto, <b>lo recomiendo</b> mucho')
    await page.getByRole('button', { name: 'Enviar opinión' }).click()
    await expect(page.getByText('Gracias, tu opinión se publicará cuando la revisemos')).toBeVisible()
    const [pendiente] = await leerOpiniones()
    expect(pendiente.estado).toBe('pendiente')

    // 3) Pendiente: no se ve en la ficha (ni para un visitante ni para el propio autor).
    const visitante = await browser.newContext()
    const paginaVisitante = await visitante.newPage()
    await paginaVisitante.goto(`${origen}/producto/${productoId}`)
    await expect(paginaVisitante.getByText('Todavía no hay opiniones').first()).toBeVisible()
    await expect(paginaVisitante.getByText('lo recomiendo')).toHaveCount(0)

    // 4) El administrador la acepta: aparece con promedio, cantidad, nombre de pila y el HTML como texto literal.
    await moderar('aceptar')
    await paginaVisitante.reload()
    await expect(paginaVisitante.getByText('4,0 de 5 · 1 opinión')).toBeVisible()
    await expect(paginaVisitante.getByText('Valeria', { exact: true })).toBeVisible()
    await expect(paginaVisitante.getByText('Muy buen producto, <b>lo recomiendo</b> mucho')).toBeVisible()
    await expect(paginaVisitante.locator('b')).toHaveCount(0)
    await visitante.close()

    // 5) El cliente la edita desde «Mis opiniones»: vuelve a pendiente y desaparece de la ficha hasta moderarla de nuevo.
    await page.goto(`${origen}/mi-cuenta?seccion=opiniones`)
    await expect(page.getByText('Publicada')).toBeVisible()
    await page.getByRole('button', { name: `Editar mi opinión sobre ${productoNombre}` }).click()
    await page.getByRole('radio', { name: '2 estrellas de 5' }).click()
    await page.getByLabel(/^Tu comentario/).fill('Cambié de idea: ya no me convence tanto')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText('Pendiente de revisión')).toBeVisible()
    expect((await leerOpiniones())[0].estado).toBe('pendiente')
    await page.goto(`${origen}/producto/${productoId}`)
    await expect(page.getByText('Todavía no hay opiniones').first()).toBeVisible()
    await expect(page.getByText('Cambié de idea')).toHaveCount(0)

    // 6) El cliente la borra (con confirmación): desaparece de «Mis opiniones» y de la base.
    await page.goto(`${origen}/mi-cuenta?seccion=opiniones`)
    await page.getByRole('button', { name: `Borrar mi opinión sobre ${productoNombre}` }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click()
    await expect(page.getByText('Todavía no dejaste opiniones')).toBeVisible()
    expect(await leerOpiniones()).toHaveLength(0)
  })
})
