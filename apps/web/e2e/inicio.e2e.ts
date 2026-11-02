import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// Cierre de MSF-156 (MSF-578 · T024 · SC-001, SC-002, SC-003): la pantalla de Inicio con los tres roles y
// con el cambio de empresa activa de la barra superior.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite
// (no entra al CI público). Ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de inicio: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer: 'return=representation', 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function rpc<T>(funcion: string, argumentos: unknown): Promise<T> {
  const r = await fetch(`${url}/rest/v1/rpc/${funcion}`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify(argumentos),
  })
  if (!r.ok) throw new Error(`RPC ${funcion}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

// Las tarjetas de Inicio son <Card> con el título como <h2>: el contenido de cada una cuelga del mismo
// <div> (el CardContent), así que se acota por tarjeta para no confundir textos repetidos (por ejemplo, el
// aviso del dólar aparece en la tarjeta y también en la lista de alertas).
const tarjeta = (page: Page, titulo: string) => page.getByRole('heading', { name: titulo, exact: true }).locator('..')
const alertas = (page: Page) => page.getByRole('list', { name: 'Alertas' })

type EmpresaSembrada = { id: string; nombre: string }

type Sembrado = {
  orgId: string
  empresaA: EmpresaSembrada
  empresaB: EmpresaSembrada
  correos: { administrador: string; consulta: string; mostrador: string; empresa: string }
  idsUsuario: string[]
}

// Siembra de la organización de prueba: dos tiendas, cuatro personas con roles distintos, un producto sin
// stock y otro con stock bajo, consultas nuevas y el recálculo de alertas (la base decide qué ve cada rol;
// acá solo se prepara el estado).
async function sembrar(sufijo: string): Promise<Sembrado> {
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E inicio ${sufijo}` })
  const [empresaA, empresaB] = (
    await rest<{ id: string; nombre: string }>(
      'empresas',
      [
        { organizacion_id: org.id, nombre: `Tienda A ${sufijo}`, activa: true },
        { organizacion_id: org.id, nombre: `Tienda B ${sufijo}`, activa: true },
      ],
      'dominio',
    )
  ).map((empresa) => ({ id: empresa.id, nombre: empresa.nombre }))

  const correos = {
    administrador: `admin-inicio-${sufijo}@example.com`,
    consulta: `consulta-inicio-${sufijo}@example.com`,
    mostrador: `mostrador-inicio-${sufijo}@example.com`,
    empresa: `empresa-inicio-${sufijo}@example.com`,
  } as const

  const ids: Record<string, string> = {}
  for (const [rol, correo] of Object.entries(correos)) {
    ids[rol] = await altaUsuario(correo)
  }

  // Membresías: el Administrador de la organización ve todas las empresas (sin filas por empresa); los
  // demás tienen su rol por tienda (el de la empresa activa resuelve las secciones por empresa).
  await rest('usuarios_organizacion', [
    { user_id: ids.administrador, organizacion_id: org.id, rol_id: 'administrador' },
    { user_id: ids.consulta, organizacion_id: org.id, rol_id: 'consulta' },
    { user_id: ids.mostrador, organizacion_id: org.id, rol_id: 'mostrador' },
    { user_id: ids.empresa, organizacion_id: org.id, rol_id: 'consulta' },
  ])
  await rest('usuarios_empresas', [
    { user_id: ids.consulta, empresa_id: empresaA.id, organizacion_id: org.id, rol_id: 'consulta' },
    { user_id: ids.mostrador, empresa_id: empresaA.id, organizacion_id: org.id, rol_id: 'mostrador' },
    // La misma persona con roles distintos en cada tienda: al cambiar de empresa activa cambia lo que ve.
    { user_id: ids.empresa, empresa_id: empresaA.id, organizacion_id: org.id, rol_id: 'mostrador' },
    { user_id: ids.empresa, empresa_id: empresaB.id, organizacion_id: org.id, rol_id: 'operador' },
  ])
  // Empresa activa de cada persona: la A, para que el estado inicial sea determinista.
  await rest('usuario_empresa_activa', [
    { user_id: ids.administrador, empresa_id: empresaA.id },
    { user_id: ids.consulta, empresa_id: empresaA.id },
    { user_id: ids.mostrador, empresa_id: empresaA.id },
    { user_id: ids.empresa, empresa_id: empresaA.id },
  ])

  // Productos: uno sin stock y otro con stock bajo (alimentan la tarjeta «Stock hoy» y sus alertas).
  const [sinStock, stockBajo] = await rest<{ id: string }>(
    'productos',
    [
      { organizacion_id: org.id, nombre: `Producto sin stock ${sufijo}`, sku: `E2E-IN-S-${sufijo}`, moneda: 'ARS', precio_lista: 100 },
      { organizacion_id: org.id, nombre: `Producto con stock bajo ${sufijo}`, sku: `E2E-IN-B-${sufijo}`, moneda: 'ARS', precio_lista: 100 },
    ],
    'dominio',
  )
  await rest(
    'existencias',
    [
      { producto_id: sinStock.id, organizacion_id: org.id, cantidad: 0, minimo: 0 },
      { producto_id: stockBajo.id, organizacion_id: org.id, cantidad: 3, minimo: 5 },
    ],
    'dominio',
  )

  // Consultas nuevas: una en la tienda A y dos en la B (el número cambia con la empresa activa).
  await rest(
    'consultas',
    [
      { organizacion_id: org.id, empresa_id: empresaA.id, origen: 'formulario', nombre: 'Visitante A', contacto: 'visitante-a@example.com', mensaje: 'Consulta de la tienda A' },
      { organizacion_id: org.id, empresa_id: empresaB.id, origen: 'formulario', nombre: 'Visitante B', contacto: 'visitante-b@example.com', mensaje: 'Consulta de la tienda B' },
      { organizacion_id: org.id, empresa_id: empresaB.id, origen: 'formulario', nombre: 'Visitante C', contacto: 'visitante-c@example.com', mensaje: 'otra consulta de la tienda B' },
    ],
    'dominio',
  )

  // Alertas: las calcula la base (service_role). Con esto la lista de Inicio tiene de dónde leer.
  await rpc('recalcular_alertas_inicio', { p_organizacion: org.id })

  return { orgId: org.id, empresaA, empresaB, correos, idsUsuario: Object.values(ids) }
}

async function limpiar(datos: Sembrado) {
  await borrar(`registro_actividad?organizacion_id=eq.${datos.orgId}`)
  await borrar(`usuario_empresa_activa?user_id=in.(${datos.idsUsuario.join(',')})`)
  await borrar(`usuarios_empresas?organizacion_id=eq.${datos.orgId}`)
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`consultas?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`existencias?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`productos?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`alertas_inicio?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`alertas_inicio_calculos?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`empresas?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  for (const id of datos.idsUsuario) await borrarUsuario(id)
}

test.describe('Inicio: permisos por rol y cambio de empresa (MSF-156 · MSF-578)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-578:T024] tres roles: el Administrador ve todo, Consulta solo lee y Mostrador no ve la tarjeta de Consultas', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    try {
      datos = await sembrar(sufijo)
      const siembra = datos

      // 1) Administrador: ve las tres tarjetas, la lista de alertas y los accesos directos de su edición.
      const admin = await abrirContextoGrabado(browser, testInfo, 'administrador')
      try {
        await prepararPaginaVisible(admin.page)
        await ingresar(admin.page, siembra.correos.administrador)
        await paso(admin.page, 'El Administrador abre Inicio', async () => {
          await admin.page.goto('/')
          await expect(admin.page.getByRole('heading', { level: 1, name: /^Buen día/ })).toBeVisible()
        })
        await paso(admin.page, 'Ve las tarjetas de stock, consultas y dólar con sus datos', async () => {
          await expect(tarjeta(admin.page, 'Stock hoy')).toBeVisible()
          await expect(tarjeta(admin.page, 'Stock hoy').getByText('1 producto sin stock')).toBeVisible()
          await expect(tarjeta(admin.page, 'Stock hoy').getByText('1 producto con stock bajo')).toBeVisible()
          await expect(tarjeta(admin.page, 'Consultas nuevas')).toBeVisible()
          await expect(tarjeta(admin.page, 'Consultas nuevas').getByText('1 consulta espera atención')).toBeVisible()
          await expect(tarjeta(admin.page, 'Dólar')).toBeVisible()
        })
        await paso(admin.page, 'Ve la lista de alertas con su enlace', async () => {
          await expect(alertas(admin.page)).toBeVisible()
          await expect(alertas(admin.page).getByText('1 producto sin stock')).toBeVisible()
          await expect(alertas(admin.page).getByText('1 consulta nueva sin atender')).toBeVisible()
          await expect(alertas(admin.page).getByText('Todavía no se cargó el dólar de hoy')).toBeVisible()
          await expect(alertas(admin.page).getByRole('link', { name: 'Abrir: 1 consulta nueva sin atender' })).toBeVisible()
        })
        await paso(admin.page, 'Tiene los accesos directos y puede cargar el dólar', async () => {
          await expect(admin.page.getByRole('link', { name: 'Nuevo comprobante' })).toBeVisible()
          await expect(admin.page.getByRole('link', { name: 'Registrar movimiento' })).toBeVisible()
          await expect(admin.page.getByRole('link', { name: 'Nuevo producto' })).toBeVisible()
          await expect(tarjeta(admin.page, 'Dólar').getByRole('link', { name: 'Cargar ahora' })).toBeVisible()
          await expect(tarjeta(admin.page, 'Tus empresas').getByRole('link', { name: 'Ver empresas' })).toBeVisible()
        })
        await rotulo(admin.page, 'El Administrador ve las tres tarjetas, las alertas y sus accesos')
      } finally {
        await cerrarContextoGrabado(admin.contexto, admin.page, testInfo)
      }

      // 2) Consulta: ve las tarjetas de lectura, pero ninguna acción de edición.
      const consulta = await abrirContextoGrabado(browser, testInfo, 'consulta')
      try {
        await prepararPaginaVisible(consulta.page)
        await ingresar(consulta.page, siembra.correos.consulta)
        await paso(consulta.page, 'Consulta abre Inicio y ve las tarjetas de lectura', async () => {
          await consulta.page.goto('/')
          await expect(tarjeta(consulta.page, 'Stock hoy')).toBeVisible()
          await expect(tarjeta(consulta.page, 'Consultas nuevas')).toBeVisible()
          await expect(tarjeta(consulta.page, 'Dólar')).toBeVisible()
          await expect(alertas(consulta.page).getByText('1 consulta nueva sin atender')).toBeVisible()
        })
        await paso(consulta.page, 'No ve los accesos directos ni las acciones de edición', async () => {
          await expect(consulta.page.getByRole('link', { name: 'Nuevo comprobante' })).toHaveCount(0)
          await expect(consulta.page.getByRole('link', { name: 'Registrar movimiento' })).toHaveCount(0)
          await expect(consulta.page.getByRole('link', { name: 'Nuevo producto' })).toHaveCount(0)
          await expect(tarjeta(consulta.page, 'Dólar').getByRole('link', { name: 'Cargar ahora' })).toHaveCount(0)
          await expect(tarjeta(consulta.page, 'Tus empresas').getByRole('link', { name: 'Ver empresas' })).toHaveCount(0)
        })
        await rotulo(consulta.page, 'Consulta lee las tarjetas, pero no tiene acciones')
      } finally {
        await cerrarContextoGrabado(consulta.contexto, consulta.page, testInfo)
      }

      // 3) Mostrador: sin permiso en Consultas no ve esa tarjeta ni su alerta.
      const mostrador = await abrirContextoGrabado(browser, testInfo, 'mostrador')
      try {
        await prepararPaginaVisible(mostrador.page)
        await ingresar(mostrador.page, siembra.correos.mostrador)
        await paso(mostrador.page, 'Mostrador abre Inicio sin la tarjeta de Consultas', async () => {
          await mostrador.page.goto('/')
          await expect(tarjeta(mostrador.page, 'Stock hoy')).toBeVisible()
          await expect(tarjeta(mostrador.page, 'Dólar')).toBeVisible()
          await expect(mostrador.page.getByRole('heading', { name: 'Consultas nuevas', exact: true })).toHaveCount(0)
        })
        await paso(mostrador.page, 'Tampoco ve la alerta de consultas', async () => {
          await expect(alertas(mostrador.page).getByText('1 consulta nueva sin atender')).toHaveCount(0)
          await expect(alertas(mostrador.page).getByText('Todavía no se cargó el dólar de hoy')).toBeVisible()
        })
        await rotulo(mostrador.page, 'Sin permiso en Consultas: no ve su tarjeta ni su alerta')
      } finally {
        await cerrarContextoGrabado(mostrador.contexto, mostrador.page, testInfo)
      }
    } finally {
      if (datos) await limpiar(datos)
    }
  })

  test('[MSF-578:T024] cambiar de empresa recarga Inicio sin dejar datos de la anterior', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    try {
      datos = await sembrar(sufijo)
      const siembra = datos

      const sesion = await abrirContextoGrabado(browser, testInfo, 'empresa')
      try {
        await prepararPaginaVisible(sesion.page)
        await ingresar(sesion.page, siembra.correos.empresa)
        await paso(sesion.page, `Abre Inicio con ${siembra.empresaA.nombre} activa`, async () => {
          await sesion.page.goto('/')
          await expect(sesion.page.getByRole('button', { name: new RegExp(`^Empresa activa: ${siembra.empresaA.nombre}`) })).toBeVisible()
        })
        await paso(sesion.page, 'Sin permiso en Consultas en esta tienda: no ve su tarjeta ni su alerta', async () => {
          await expect(sesion.page.getByRole('heading', { name: 'Consultas nuevas', exact: true })).toHaveCount(0)
          await expect(alertas(sesion.page).getByText('1 consulta nueva sin atender')).toHaveCount(0)
        })
        await paso(sesion.page, `Cambia a ${siembra.empresaB.nombre}`, async () => {
          await clic(sesion.page, sesion.page.getByRole('button', { name: /^Empresa activa:/ }))
          await clic(sesion.page, sesion.page.getByRole('menuitem', { name: new RegExp(siembra.empresaB.nombre) }))
          await expect(sesion.page.getByRole('button', { name: new RegExp(`^Empresa activa: ${siembra.empresaB.nombre}`) })).toBeVisible()
        })
        await paso(sesion.page, 'Recarga todo: ve la tarjeta de Consultas con los datos de la tienda nueva', async () => {
          await expect(tarjeta(sesion.page, 'Consultas nuevas')).toBeVisible()
          await expect(tarjeta(sesion.page, 'Consultas nuevas').getByText('2 consultas esperan atención')).toBeVisible()
          await expect(alertas(sesion.page).getByText('2 consultas nuevas sin atender')).toBeVisible()
        })
        await paso(sesion.page, 'No queda ningún dato de la tienda anterior', async () => {
          await expect(alertas(sesion.page).getByText('1 consulta nueva sin atender')).toHaveCount(0)
          await expect(tarjeta(sesion.page, 'Tus empresas').getByText('Empresa activa')).toBeVisible()
        })
        await rotulo(sesion.page, 'Al cambiar de empresa, Inicio se recarga con los datos de la nueva')
      } finally {
        await cerrarContextoGrabado(sesion.contexto, sesion.page, testInfo)
      }
    } finally {
      if (datos) await limpiar(datos)
    }
  })
})
