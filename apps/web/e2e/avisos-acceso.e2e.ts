import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// MSF-639: los avisos de acceso deben seguir el patrón común del panel.
// 1) Sin permiso de escritura, `/empresas` y `/organizacion` muestran «No tenés acceso a esta
//    sección» (el patrón de Rentabilidad, Listas y Motivos), no el error rojo «Acceso restringido».
// 2) En el detalle de una empresa, «Solo lectura» es un aviso informativo (tono info), no un error rojo.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node
// (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el
// archivo se omite (no entra al CI público). Ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de avisos de acceso: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

type Sembrado = {
  orgId: string
  empresaId: string
  nombreEmpresa: string
  correos: { administrador: string; operador: string }
  idsUsuario: string[]
}

// Una organización con una tienda y dos personas: el Administrador escribe y el Operador solo lee.
async function sembrar(sufijo: string): Promise<Sembrado> {
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E avisos acceso ${sufijo}` })
  const [empresa] = await rest<{ id: string; nombre: string }>(
    'empresas',
    { organizacion_id: org.id, nombre: `Tienda avisos ${sufijo}`, activa: true },
    'dominio',
  )

  const correos = {
    administrador: `admin-avisos-${sufijo}@example.com`,
    operador: `operador-avisos-${sufijo}@example.com`,
  } as const
  const ids: Record<string, string> = {}
  for (const [rol, correo] of Object.entries(correos)) {
    ids[rol] = await altaUsuario(correo)
  }
  // El Operador tiene rol de organización (no de empresa): `private.puede_escribir()` es falso y
  // `dominio.empresas` sigue siendo legible, que es justo el caso que muestra «Solo lectura».
  await rest('usuarios_organizacion', [
    { user_id: ids.administrador, organizacion_id: org.id, rol_id: 'administrador' },
    { user_id: ids.operador, organizacion_id: org.id, rol_id: 'operador' },
  ])
  // Asignación por empresa: sin ella el selector de la barra superior quedaría vacío.
  await rest('usuarios_empresas', [
    { user_id: ids.operador, empresa_id: empresa.id, organizacion_id: org.id, rol_id: 'operador' },
  ])
  await rest('usuario_empresa_activa', [
    { user_id: ids.administrador, empresa_id: empresa.id },
    { user_id: ids.operador, empresa_id: empresa.id },
  ])

  return {
    orgId: org.id,
    empresaId: empresa.id,
    nombreEmpresa: empresa.nombre,
    correos,
    idsUsuario: Object.values(ids),
  }
}

async function limpiar(datos: Sembrado) {
  await borrar(`registro_actividad?organizacion_id=eq.${datos.orgId}`)
  await borrar(`usuario_empresa_activa?user_id=in.(${datos.idsUsuario.join(',')})`)
  await borrar(`usuarios_empresas?organizacion_id=eq.${datos.orgId}`)
  await borrar(`usuarios_organizacion?organizacion_id=eq.${datos.orgId}`)
  await borrar(`empresas?organizacion_id=eq.${datos.orgId}`, 'dominio')
  await borrar(`organizaciones?id=eq.${datos.orgId}`)
  for (const id of datos.idsUsuario) await borrarUsuario(id)
}

test.describe('Avisos de acceso (MSF-639)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-639:AVISOS] sin permiso de escritura: «No tenés acceso a esta sección» y «Solo lectura» informativo, sin errores rojos', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    let datos: Sembrado | undefined
    try {
      datos = await sembrar(sufijo)
      const siembra = datos

      // 1) Operador: el patrón común de acceso restringido en Empresas y en Mi organización.
      const operador = await abrirContextoGrabado(browser, testInfo, 'operador')
      try {
        await prepararPaginaVisible(operador.page)
        await ingresar(operador.page, siembra.correos.operador)

        await paso(operador.page, 'El Operador abre Empresas y ve el acceso restringido del panel', async () => {
          await operador.page.goto('/empresas')
          await expect(operador.page.getByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' })).toBeVisible()
          await expect(operador.page.getByText('Tu rol (actual) no incluye Empresas. Pedile acceso a un administrador.')).toBeVisible()
        })
        await paso(operador.page, 'No es un error rojo: no aparece el aviso viejo «Acceso restringido»', async () => {
          await expect(operador.page.getByText('Acceso restringido')).toHaveCount(0)
          await expect(operador.page.locator('.MuiAlert-standardError')).toHaveCount(0)
        })
        await rotulo(operador.page, 'Empresas: acceso restringido con el patrón común, no un error')

        await paso(operador.page, 'El Operador abre Mi organización y ve el mismo patrón', async () => {
          await operador.page.goto('/organizacion')
          await expect(operador.page.getByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' })).toBeVisible()
          await expect(operador.page.getByText('Tu rol (actual) no incluye Mi organización. Pedile acceso a un administrador.')).toBeVisible()
          await expect(operador.page.getByText('Acceso restringido')).toHaveCount(0)
          await expect(operador.page.locator('.MuiAlert-standardError')).toHaveCount(0)
        })
        await rotulo(operador.page, 'Mi organización: el mismo acceso restringido, sin error rojo')

        // 2) Operador: en el detalle de la empresa, «Solo lectura» es un aviso informativo.
        await paso(operador.page, 'En el detalle de la empresa, «Solo lectura» es un aviso informativo', async () => {
          await operador.page.goto(`/empresas/edit/${siembra.empresaId}`)
          await expect(operador.page.getByRole('note')).toHaveText(
            'Solo lectura: únicamente los administradores pueden editar los datos de la empresa.',
          )
          await expect(operador.page.getByLabel('Nombre comercial')).toBeDisabled()
        })
        await paso(operador.page, 'El aviso informativo no es un error rojo', async () => {
          await expect(operador.page.locator('.MuiAlert-standardError')).toHaveCount(0)
          await expect(operador.page.getByText('Acceso restringido')).toHaveCount(0)
        })
        await rotulo(operador.page, 'Detalle de la empresa: «Solo lectura» informativo, no un error')
      } finally {
        await cerrarContextoGrabado(operador.contexto, operador.page, testInfo)
      }

      // 3) Administrador: los avisos de acceso no aparecen donde hay permiso de escritura.
      const administrador = await abrirContextoGrabado(browser, testInfo, 'administrador')
      try {
        await prepararPaginaVisible(administrador.page)
        await ingresar(administrador.page, siembra.correos.administrador)

        await paso(administrador.page, 'El Administrador ve el listado de empresas, sin acceso restringido', async () => {
          await administrador.page.goto('/empresas')
          await expect(administrador.page.getByText(siembra.nombreEmpresa)).toBeVisible()
          await expect(administrador.page.getByRole('heading', { level: 1, name: 'No tenés acceso a esta sección' })).toHaveCount(0)
        })
        await paso(administrador.page, 'En el detalle puede editar: no hay aviso de «Solo lectura»', async () => {
          await administrador.page.goto(`/empresas/edit/${siembra.empresaId}`)
          await expect(administrador.page.getByLabel('Nombre comercial')).toBeEnabled()
          await expect(administrador.page.getByRole('note')).toHaveCount(0)
        })
        await rotulo(administrador.page, 'El Administrador no ve ninguno de los avisos de acceso')
      } finally {
        await cerrarContextoGrabado(administrador.contexto, administrador.page, testInfo)
      }
    } finally {
      if (datos) await limpiar(datos)
    }
  })
})
