import { randomUUID } from 'node:crypto'
import { expect, test } from './fixture'
import type { Page } from '@playwright/test'

// MSF-274 · F-CON-06 (SC-002, parte E2E): se crea una respuesta rápida con variables desde Consultas y se usa al
// responder una consulta: el texto inicial que se abre en el correo es el esperado, con las variables resueltas.
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

test.describe('Consultas · respuestas rápidas (MSF-274, F-CON-06)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-274:T021] crear una respuesta rápida con variables y usarla al responder arma el texto inicial esperado', async ({ page }) => {
    test.setTimeout(120_000)
    const sufijo = randomUUID().slice(0, 8)
    const host = `rapidas-${sufijo}.localhost`
    const correo = `admin-rapidas-${sufijo}@example.com`
    const visitante = `Visitante Rápidas ${sufijo}`
    const tienda = `Tienda Rápidas ${sufijo}`
    const orgs: string[] = []
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E rápidas ${sufijo}` }])
      orgs.push(org.id)
      const [{ id: empresaId }] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: tienda }, 'dominio')
      await rest('tiendas', { organizacion_id: org.id, empresa_id: empresaId, dominio: host }, 'dominio')
      const idUsuario = await altaUsuario(correo)
      usuarios.push(idUsuario)
      await rest('usuarios_organizacion', { user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' })
      const idConsulta = await enviarConsultaPublica(host, 'formulario', visitante, 'visitante@example.com')

      // `window.open` se captura para no salir al cliente de correo real.
      await page.addInitScript(() => {
        const abiertos: string[] = []
        ;(window as unknown as { __abiertos: string[] }).__abiertos = abiertos
        window.open = (direccion) => { abiertos.push(String(direccion)); return null }
      })
      await ingresar(page, correo)

      await page.goto('/consultas')
      await page.getByRole('button', { name: 'Respuestas rápidas' }).click()
      const gestion = page.getByRole('dialog', { name: /Respuestas rápidas/ })
      await gestion.getByRole('button', { name: 'Nueva respuesta' }).click()
      await gestion.getByLabel(/Título/).fill('Gracias por escribir')
      await gestion.getByLabel(/Texto/).fill('Hola {nombre}, gracias por escribir a {tienda}.')
      await gestion.getByRole('button', { name: 'Guardar' }).click()
      await expect(gestion.getByText('Gracias por escribir', { exact: true })).toBeVisible()
      await gestion.getByRole('button', { name: 'Cerrar', exact: true }).last().click()

      await page.goto(`/consultas?consulta=${idConsulta}`)
      const detalle = page.getByRole('dialog', { name: `Consulta de ${visitante}` })
      await detalle.getByRole('combobox', { name: 'Respuesta rápida' }).click()
      await page.getByRole('option', { name: 'Gracias por escribir' }).click()
      await detalle.getByRole('button', { name: 'Responder por correo' }).click()
      await expect(page.getByText(`Consulta En curso a tu nombre · ${visitante}`)).toBeVisible()

      const [abierto] = await page.evaluate(() => (window as unknown as { __abiertos: string[] }).__abiertos)
      expect(abierto).toMatch(/^mailto:visitante%40example\.com\?subject=/)
      expect(decodeURIComponent(abierto)).toContain(`body=Hola ${visitante}, gracias por escribir a ${tienda}.`)
    } finally {
      for (const org of orgs) await borrar(`organizaciones?id=eq.${org}`)
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
