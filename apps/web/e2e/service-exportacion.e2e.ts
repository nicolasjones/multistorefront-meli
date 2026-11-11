import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// F-SVC-23 (MSF-168, T049, FR-060/FR-061): el botón «Exportar» del listado de reparaciones descarga un CSV
// con las nueve columnas del listado y todas las filas del filtro vigente.
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node (la
// service-role key nunca llega al navegador). Las reparaciones se crean con la RPC `crear_reparacion` y la
// sesión de la persona, como la app. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no
// entra al CI público): ver docs/e2e-app.md y docs/service-reportes.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return prefer.includes('return=representation') ? ((await r.json()) as T[]) : []
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

// Sesión de la persona (no la service-role) para llamar a la RPC como lo haría la app.
async function crearReparacionComo(correo: string, empresaId: string, clienteId: string, modeloId: string, serie: string): Promise<string> {
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!sesion.ok) throw new Error(`login de ${correo}: ${sesion.status} ${await sesion.text()}`)
  const { access_token } = (await sesion.json()) as { access_token: string }
  const r = await fetch(`${url}/rest/v1/rpc/crear_reparacion`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_empresa_id: empresaId, p_cliente_id: clienteId, p_modelo_id: modeloId, p_numero_serie: serie }),
  })
  if (!r.ok) throw new Error(`crear_reparacion: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { id: string }).id
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Service técnico · exportación del listado (F-SVC-23)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('descarga el listado filtrado en un CSV con las nueve columnas [MSF-168:T049]', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-exp-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      // El sembrado de F-SVC-01 crea modelos y estados al dar de alta la organización.
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E export ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente ${sufijo}`, tipo: 'minorista' })
      const [modelo] = await (async () => {
        const r = await fetch(`${url}/rest/v1/modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, {
          headers: cabeceras({ 'accept-profile': 'dominio' }),
        })
        if (!r.ok) throw new Error(`modelos: ${r.status} ${await r.text()}`)
        return (await r.json()) as Array<{ id: string }>
      })()
      await crearReparacionComo(correo, empresa.id, cliente.id, modelo.id, `EXP-${sufijo}-1`)
      await crearReparacionComo(correo, empresa.id, cliente.id, modelo.id, `EXP-${sufijo}-2`)

      const contexto = await browser.newContext({ acceptDownloads: true })
      const page = await contexto.newPage()
      await ingresar(page, correo)
      await page.goto('/service-tecnico/reparaciones')
      await expect(page.getByRole('table', { name: 'Reparaciones' })).toBeVisible()
      await expect(page.getByText('2 reparaciones')).toBeVisible()

      const descarga = page.waitForEvent('download')
      await page.getByRole('button', { name: 'Exportar' }).click()
      const archivo = await descarga

      expect(archivo.suggestedFilename()).toMatch(/^reparaciones-\d{4}-\d{2}-\d{2}\.csv$/)
      const ruta = await archivo.path()
      expect(ruta).toBeTruthy()
      const contenido = readFileSync(ruta as string, 'utf8').replace('\uFEFF', '')
      const lineas = contenido.split('\r\n').filter(Boolean)
      expect(lineas[0]).toBe('Reparación;Tienda;Cliente;Equipo;N.º de serie;Estado;Técnico;Entrega;Total')
      expect(lineas).toHaveLength(3)
      expect(lineas[1]).toContain(`Cliente ${sufijo}`)
      // El archivo no lleva costos internos ni ganancia (FR-061).
      expect(contenido).not.toMatch(/costo|ganancia/i)

      await contexto.close()
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
