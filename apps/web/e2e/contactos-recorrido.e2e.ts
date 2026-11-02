import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'

// MSF-260 · F-CON-05 (SC-001): desde una consulta se crea un contacto con consentimiento, se ve su historial,
// se anonimiza y desaparecen sus datos personales (contacto y consulta) sin romper la consulta ni la venta.
// Requiere el stack local (`pnpm dev:supabase`). Siembra con la API admin desde Node (la service-role key nunca
// llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de contactos: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
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

async function borrar(ruta: string) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

test.describe('Contactos · libreta, historial y anonimización (MSF-260, F-CON-05)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-260:T013] crear un contacto desde una consulta, ver su historial y anonimizarlo sin romper consultas ni ventas', async ({ page }) => {
    test.setTimeout(120_000)
    const sufijo = randomUUID().slice(0, 8)
    const correoAdmin = `admin-contactos-${sufijo}@example.com`
    const visitante = `Visitante ${sufijo}`
    const correoVisitante = `visitante-${sufijo}@example.com`
    const orgs: string[] = []
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E contactos ${sufijo}` }])
      orgs.push(org.id)
      const [{ id: empresaId }] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda Contactos ${sufijo}` }, 'dominio')
      const idAdmin = await altaUsuario(correoAdmin)
      usuarios.push(idAdmin)
      await rest('usuarios_organizacion', { user_id: idAdmin, organizacion_id: org.id, rol_id: 'administrador' })
      const [{ id: consultaId }] = await rest<{ id: string }>('consultas', {
        organizacion_id: org.id, empresa_id: empresaId, origen: 'formulario', nombre: visitante,
        contacto: correoVisitante, mensaje: 'Hola, ¿tienen stock?',
      }, 'dominio')
      const [{ id: clienteId }] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id, numero: 1, nombre: `Cliente ${sufijo}`, correo: `cliente-${sufijo}@example.com`, tipo: 'minorista',
      })
      const [{ id: comprobanteId }] = await rest<{ id: string }>('comprobantes_venta', {
        organizacion_id: org.id, empresa_id: empresaId, cliente_id: clienteId, tipo: 'factura', numero: `0001-${sufijo}`,
        fecha: new Date().toISOString().slice(0, 10), estado: 'emitida', total_sin_iva: 1000, total_con_iva: 1210,
      }, 'dominio')

      await page.goto('/login')
      await page.getByLabel('Correo').fill(correoAdmin)
      await page.getByLabel('Contraseña').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).not.toHaveURL(/\/login/)

      // Crear el contacto desde la consulta, con el consentimiento confirmado.
      await page.goto(`/consultas?consulta=${consultaId}`)
      const detalle = page.getByRole('dialog', { name: `Consulta de ${visitante}` })
      await detalle.getByRole('button', { name: 'Crear contacto' }).click()
      const formulario = page.getByRole('dialog', { name: /Crear contacto/ })
      await expect(formulario.getByLabel(/Nombre/)).toHaveValue(visitante)
      await expect(formulario.getByLabel('Correo')).toHaveValue(correoVisitante)
      await formulario.getByRole('button', { name: 'Guardar contacto' }).click()
      await expect(formulario.getByText('Confirmá el consentimiento para guardar el contacto.').first()).toBeVisible()
      await formulario.getByRole('checkbox').check()
      await formulario.getByRole('button', { name: 'Guardar contacto' }).click()
      await expect(page.getByRole('dialog', { name: `Consulta de ${visitante}` }).getByRole('link', { name: visitante })).toBeVisible()

      // La libreta lo lista y la ficha muestra su historial; se vincula la venta.
      await page.goto('/contactos')
      await page.getByRole('link', { name: visitante }).click()
      await expect(page.getByText(/Consulta · Hola, ¿tienen stock\?/)).toBeVisible()
      await page.getByRole('button', { name: 'Vincular comprobante' }).click()
      await page.getByLabel('Número o cliente').fill(`0001-${sufijo}`)
      await page.getByRole('button', { name: 'Buscar' }).click()
      await page.getByRole('button', { name: 'Vincular', exact: true }).click()
      await expect(page.getByText(new RegExp(`Compra · Factura 0001-${sufijo}`))).toBeVisible()

      // Anonimizar: el diálogo avisa que es irreversible.
      await page.getByRole('button', { name: 'Anonimizar' }).click()
      const confirmacion = page.getByRole('dialog', { name: 'Anonimizar contacto' })
      await expect(confirmacion.getByText('Esta acción no se puede deshacer.')).toBeVisible()
      await confirmacion.getByRole('button', { name: 'Anonimizar' }).click()
      await expect(page.getByText('Este contacto fue anonimizado', { exact: false })).toBeVisible()
      await expect(page.getByLabel('Nombre')).toBeDisabled()

      // Desaparecen los datos personales del contacto y de la consulta; la consulta y la venta siguen.
      const [contacto] = await leer<{ nombre: string; correo: string | null; anonimizado_en: string | null }>(
        `contactos?organizacion_id=eq.${org.id}&select=nombre,correo,anonimizado_en`, 'dominio')
      expect(contacto).toMatchObject({ nombre: 'Anonimizado', correo: null })
      expect(contacto.anonimizado_en).not.toBeNull()
      const [consulta] = await leer<{ nombre: string; contacto: string; estado: string }>(
        `consultas?id=eq.${consultaId}&select=nombre,contacto,estado`, 'dominio')
      expect(consulta).toMatchObject({ nombre: 'Anonimizado', contacto: 'Anonimizado', estado: 'nueva' })
      const [venta] = await leer<{ total_con_iva: number; estado: string }>(
        `comprobantes_venta?id=eq.${comprobanteId}&select=total_con_iva,estado`, 'dominio')
      expect(venta).toMatchObject({ total_con_iva: 1210, estado: 'emitida' })

      // La bandeja sigue abriendo la consulta.
      await page.goto(`/consultas?consulta=${consultaId}`)
      await expect(page.getByRole('dialog', { name: 'Consulta de Anonimizado' })).toBeVisible()
    } finally {
      for (const org of orgs) await borrar(`organizaciones?id=eq.${org}`)
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
