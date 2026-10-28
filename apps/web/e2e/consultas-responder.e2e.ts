import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// MSF-244 · F-CON-04 (SC-004, parte E2E): «Responder por…» desde el detalle de una consulta. Una consulta de
// WhatsApp y una de correo abren el enlace correcto (wa.me / mailto, con el texto inicial), quedan En curso con
// el administrador como responsable, y el rol de solo lectura ve el botón deshabilitado.
// Requiere el stack local (`pnpm dev:supabase`). Siembra con la API admin desde Node (la service-role key nunca
// llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key escribe datos y crea usuarios con contraseña conocida: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de consultas: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function borrar(ruta: string) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
}

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

// `crear_consulta_publica` ya no es pública (saltearía el anti-spam): la tienda entra por `enviar_consulta_contacto`
// y este E2E, que no prueba el límite, da el alta con service-role contra el Supabase local.
async function enviarConsultaPublica(host: string, origen: 'formulario' | 'whatsapp', nombre: string, contacto: string): Promise<string> {
  const r = await fetch(`${url}/rest/v1/rpc/crear_consulta_publica`, {
    method: 'POST',
    headers: cabeceras({ 'content-profile': 'publico' }),
    body: JSON.stringify({ host, origen, nombre, contacto, mensaje: origen === 'formulario' ? 'Hola, ¿tienen stock?' : null }),
  })
  if (!r.ok) throw new Error(`crear_consulta_publica: ${r.status} ${await r.text()}`)
  return (await r.json()) as string
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Consultas · responder desde el panel (MSF-244, F-CON-04)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-244:T017] responder por WhatsApp y por correo abre el enlace, deja En curso con responsable; solo lectura no responde', async ({ browser }) => {
    test.setTimeout(120_000)
    const sufijo = randomUUID().slice(0, 8)
    const host = `responder-${sufijo}.localhost`
    const correos = { admin: `admin-resp-${sufijo}@example.com`, lectura: `lectura-resp-${sufijo}@example.com` }
    const visitanteWa = `Visitante WA ${sufijo}`
    const visitanteMail = `Visitante Mail ${sufijo}`
    const orgs: string[] = []
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E responder ${sufijo}` }])
      orgs.push(org.id)
      const [{ id: empresaId }] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda Responder ${sufijo}` }, 'dominio')
      await rest('tiendas', { organizacion_id: org.id, empresa_id: empresaId, dominio: host }, 'dominio')
      for (const [correo, rol] of [[correos.admin, 'administrador'], [correos.lectura, 'consulta']]) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', { user_id: id, organizacion_id: org.id, rol_id: rol })
      }
      const idWa = await enviarConsultaPublica(host, 'whatsapp', visitanteWa, '+54 9 11 5555-1234')
      const idMail = await enviarConsultaPublica(host, 'formulario', visitanteMail, 'visitante@example.com')

      // Administrador (consultas = edición): el enlace se abre en pestaña nueva y la consulta queda En curso.
      const contextoAdmin = await browser.newContext()
      // `window.open` se captura para no salir a WhatsApp / al cliente de correo reales.
      await contextoAdmin.addInitScript(() => {
        const abiertos: string[] = []
        ;(window as unknown as { __abiertos: string[] }).__abiertos = abiertos
        window.open = (direccion) => { abiertos.push(String(direccion)); return null }
      })
      const admin = await contextoAdmin.newPage()
      await ingresar(admin, correos.admin)
      const abiertos = () => admin.evaluate(() => (window as unknown as { __abiertos: string[] }).__abiertos)

      await admin.goto(`/consultas?consulta=${idWa}`)
      const detalleWa = admin.getByRole('dialog', { name: `Consulta de ${visitanteWa}` })
      await detalleWa.getByRole('button', { name: 'Responder por WhatsApp' }).click()
      await expect(admin.getByText(`Consulta En curso a tu nombre · ${visitanteWa}`)).toBeVisible()
      expect((await abiertos())[0]).toMatch(/^https:\/\/wa\.me\/5491155551234\?text=Hola%20/)

      await admin.goto(`/consultas?consulta=${idMail}`)
      const detalleMail = admin.getByRole('dialog', { name: `Consulta de ${visitanteMail}` })
      await detalleMail.getByRole('button', { name: 'Responder por correo' }).click()
      await expect(admin.getByText(`Consulta En curso a tu nombre · ${visitanteMail}`)).toBeVisible()
      expect((await abiertos())[1]).toMatch(/^mailto:visitante%40example\.com\?subject=/)

      // Quedó En curso con responsable (se relee el detalle desde la base).
      await admin.goto(`/consultas?consulta=${idWa}`)
      const releido = admin.getByRole('dialog', { name: `Consulta de ${visitanteWa}` })
      await expect(releido.getByRole('combobox', { name: 'Estado' })).toHaveText('En curso')
      await expect(releido.getByRole('combobox', { name: 'Responsable' })).not.toHaveText('Sin responsable')
      await contextoAdmin.close()

      // Rol Consulta (Lectura): el botón está deshabilitado.
      const contextoLectura = await browser.newContext()
      const lectura = await contextoLectura.newPage()
      await ingresar(lectura, correos.lectura)
      await lectura.goto(`/consultas?consulta=${idMail}`)
      const detalleLectura = lectura.getByRole('dialog', { name: `Consulta de ${visitanteMail}` })
      await expect(detalleLectura.getByRole('button', { name: 'Responder por correo' })).toBeDisabled()
      await contextoLectura.close()
    } finally {
      for (const org of orgs) await borrar(`organizaciones?id=eq.${org}`)
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
