import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-338 (T015, FR-010): «Reportes de ventas» con los roles de la matriz (sección `reportes`),
// cambio de empresa que reencuadra el filtro de tienda y exportación del ranking a Excel. Requiere el
// stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la service-role
// key nunca llega al navegador). El tablero de Superset no se monta acá (necesita un Superset real): el
// marco, el filtro de tienda, el botón de exportar y el acceso salen de la pantalla y de la base.
// Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key escribe datos y crea usuarios con contraseña conocida: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ventas-reportes: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function altaUsuario(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras(),
    body: JSON.stringify({ email: correo, password, email_confirm: true }),
  })
  if (!r.ok) throw new Error(`alta de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

// JWT de la persona: la RPC corre con su sesión (organización y rol salen del token).
async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`ingreso de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

// Llama la RPC de lectura del ranking COMO la persona: el servidor decide, no el botón (SC-005).
async function leerRanking(token: string) {
  const hoy = new Date().toISOString().slice(0, 10)
  const r = await fetch(`${url}/rest/v1/rpc/leer_ranking_ventas`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_desde: hoy, p_hasta: hoy, p_incluir_consumidor_final: true }),
  })
  return { ok: r.ok, estado: r.status, texto: await r.text() }
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Reportes de ventas (MSF-338, FR-010)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('roles, cambio de empresa y exportación del ranking', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const roles = {
      administrador: `admin-rv-${sufijo}@example.com`,
      administracion: `administracion-rv-${sufijo}@example.com`,
      operador: `operador-rv-${sufijo}@example.com`,
      consulta: `consulta-rv-${sufijo}@example.com`,
    } as const
    const empresaA = `Tienda A ${sufijo}`
    const empresaB = `Tienda B ${sufijo}`

    let orgId: string | undefined
    const ids: string[] = []
    const abrir = async (correo: string) => {
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await ingresar(page, correo)
      return { contexto, page }
    }
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E reportes ventas ${sufijo}` })
      orgId = org.id
      const asignaciones: Array<{ user_id: string; organizacion_id: string; rol_id: string }> = []
      for (const [rol, correo] of Object.entries(roles)) {
        const id = await altaUsuario(correo)
        ids.push(id)
        asignaciones.push({ user_id: id, organizacion_id: org.id, rol_id: rol })
      }
      await rest('usuarios_organizacion', asignaciones)
      const [idA, idB] = (
        await rest<{ id: string }>(
          'empresas',
          [
            { organizacion_id: org.id, nombre: empresaA },
            { organizacion_id: org.id, nombre: empresaB },
          ],
          'dominio',
        )
      ).map((e) => e.id)
      // Una factura confirmada por tienda, de hoy: el ranking exportable no queda vacío.
      const [clienteA, clienteB] = await rest<{ id: string }>('clientes', [
        { organizacion_id: org.id, numero: 1, nombre: `Cliente A ${sufijo}`, tipo: 'minorista' },
        { organizacion_id: org.id, numero: 2, nombre: `Cliente B ${sufijo}`, tipo: 'minorista' },
      ])
      const hoy = new Date().toISOString().slice(0, 10)
      const base = { organizacion_id: org.id, fecha: hoy, canal: 'mostrador', tipo: 'factura', estado: 'confirmada', operador_id: ids[0] }
      await rest(
        'comprobantes_venta',
        [
          { ...base, cliente_id: clienteA.id, empresa_id: idA, numero: '00000001', total_sin_iva: 100, total_con_iva: 121 },
          { ...base, cliente_id: clienteB.id, empresa_id: idB, numero: '00000001', total_sin_iva: 200, total_con_iva: 242 },
        ],
        'dominio',
      )

      // Operador y Consulta: acceso restringido, sin marco ni botón de exportar; el servidor también rechaza.
      for (const correo of [roles.operador, roles.consulta]) {
        const { contexto, page } = await abrir(correo)
        await page.goto('/ventas/reportes')
        await expect(page.getByRole('heading', { name: 'No tenés acceso a esta sección' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Exportar a Excel' })).toHaveCount(0)
        await contexto.close()
        const rechazo = await leerRanking(await tokenDe(correo))
        expect(rechazo.ok).toBe(false)
        expect(rechazo.texto).toContain('42501')
      }

      // Administración: tiene la sección `reportes`, así que ve la pantalla (matriz de permisos).
      const administracion = await abrir(roles.administracion)
      await administracion.page.goto('/ventas/reportes')
      await expect(administracion.page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible()
      await administracion.contexto.close()

      // Administrador: ve la pantalla, cambia de empresa y exporta el ranking.
      const admin = await abrir(roles.administrador)
      await admin.page.goto('/ventas/reportes')
      await expect(admin.page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible()
      await expect(admin.page.getByRole('tab', { name: 'Más vendidos' })).toBeVisible()
      await expect(admin.page.getByRole('tab', { name: 'Ranking de clientes' })).toBeVisible()

      // Cambio de empresa (Principio VIII): el filtro de tienda sigue a la empresa activa de la barra superior.
      const activa = admin.page.getByRole('button', { name: /^Empresa activa:/ })
      await expect(activa).toBeVisible()
      const enA = ((await activa.getAttribute('aria-label')) ?? '').includes(empresaA)
      const [actual, destino] = enA ? [empresaA, empresaB] : [empresaB, empresaA]
      const filtro = admin.page.getByRole('group', { name: 'Filtrar por tienda' })
      await expect(filtro.getByRole('button', { name: actual })).toHaveAttribute('aria-pressed', 'true')
      await activa.click()
      await admin.page.getByRole('menuitem', { name: new RegExp(destino) }).click()
      await expect(admin.page.getByRole('button', { name: `Empresa activa: ${destino}` })).toBeVisible()
      await expect(filtro.getByRole('button', { name: destino })).toHaveAttribute('aria-pressed', 'true')
      await expect(filtro.getByRole('button', { name: actual })).toHaveAttribute('aria-pressed', 'false')

      // Exportación: solo en la pestaña «Ranking de clientes»; baja un .xlsx real y avisa.
      await expect(admin.page.getByRole('button', { name: 'Exportar a Excel' })).toHaveCount(0)
      await admin.page.getByRole('tab', { name: 'Ranking de clientes' }).click()
      const descarga = admin.page.waitForEvent('download')
      await admin.page.getByRole('button', { name: 'Exportar a Excel' }).click()
      expect((await descarga).suggestedFilename()).toMatch(/^ranking-clientes-ventas-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/)
      await expect(admin.page.getByText('Exportación lista: el archivo se descargó.')).toBeVisible()
      await admin.contexto.close()

      // El servidor devuelve al Administrador solo el ranking de su organización.
      const lectura = await leerRanking(await tokenDe(roles.administrador))
      expect(lectura.ok).toBe(true)
      expect((JSON.parse(lectura.texto) as unknown[]).length).toBe(2)
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`comprobantes_venta?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`clientes?organizacion_id=eq.${orgId}`)
        await borrar(`empresas?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`registro_actividad?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
