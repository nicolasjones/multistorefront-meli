import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-122 (SC-004, SC-008): una consulta enviada desde la tienda aparece en la bandeja en menos de
// 5 s y dispara un correo (Mailpit); se abre el enlace, se asigna, anota y resuelve con tres roles
// (administrador edita, consulta solo lee, mostrador no accede) y una segunda organización no la ve.
// Requiere el stack local (`pnpm dev:supabase`), la función `enviar-aviso-consulta` servida con
// AVISOS_CONSULTAS_TOKEN y PANEL_URL apuntando a la web del E2E, y Mailpit. Siembra con la API admin desde Node
// (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite (no entra al CI público): ver docs/e2e-app.md y docs/consultas.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const mailpit = process.env.MAILPIT_URL ?? `http://127.0.0.1:${process.env.SUPABASE_MAILPIT_PORT ?? '4302'}`
const tokenAvisos = process.env.AVISOS_CONSULTAS_TOKEN ?? 'change-me-local'
const password = 'Correcta-12345!'
const LIMITE_BANDEJA_MS = 5_000

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

// La tienda llama a la RPC pública como `anon`; el E2E hace lo mismo (sin sesión ni service-role).
async function enviarConsultaPublica(host: string, nombre: string, mensaje: string): Promise<string> {
  const r = await fetch(`${url}/rest/v1/rpc/crear_consulta_publica`, {
    method: 'POST',
    headers: { apikey: anonKey ?? '', 'content-type': 'application/json', 'content-profile': 'publico' },
    body: JSON.stringify({ host, origen: 'formulario', nombre, contacto: 'visitante@example.com', mensaje }),
  })
  if (!r.ok) throw new Error(`crear_consulta_publica: ${r.status} ${await r.text()}`)
  return (await r.json()) as string
}

// El barrido que en producción hace el flow de Kestra `avisos-consultas`, invocado una vez a mano.
async function barrerAvisos() {
  const r = await fetch(`${url}/functions/v1/enviar-aviso-consulta`, {
    method: 'POST',
    headers: { apikey: anonKey ?? '', authorization: `Bearer ${anonKey}`, 'x-aviso-token': tokenAvisos, 'content-type': 'application/json' },
    body: JSON.stringify({ barrer: true }),
  })
  if (!r.ok) throw new Error(`enviar-aviso-consulta: ${r.status} ${await r.text()}`)
}

// Busca en Mailpit el aviso con el asunto de la empresa y devuelve el enlace `/consultas?consulta=<id>` del cuerpo.
async function enlaceDelAviso(destinatario: string, empresa: string): Promise<string> {
  const limite = Date.now() + 20_000
  while (Date.now() < limite) {
    const lista = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${destinatario}`)}`)
    if (lista.ok) {
      const { messages } = (await lista.json()) as { messages: Array<{ ID: string; Subject: string }> }
      const aviso = messages.find((m) => m.Subject === `Nueva consulta · ${empresa}`)
      if (aviso) {
        const detalle = (await (await fetch(`${mailpit}/api/v1/message/${aviso.ID}`)).json()) as { Text: string }
        const enlace = detalle.Text.match(/https?:\/\/\S+\/consultas\?consulta=[0-9a-f-]{36}/i)?.[0]
        if (enlace) return enlace
      }
    }
    await new Promise((resolver) => setTimeout(resolver, 500))
  }
  throw new Error(`No llegó el aviso a ${destinatario} en 20 s`)
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Consultas · de la tienda al aviso y la bandeja (MSF-122, SC-004, SC-008)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('envío público, bandeja en menos de 5 s, correo con enlace, atención por rol y aislamiento entre organizaciones', async ({ browser }) => {
    test.setTimeout(120_000)
    const sufijo = randomUUID().slice(0, 8)
    const host = `consultas-${sufijo}.localhost`
    const empresa = `Tienda Consultas ${sufijo}`
    const correoAvisos = `avisos-${sufijo}@example.com`
    const correos = {
      admin: `admin-con-${sufijo}@example.com`,
      lectura: `lectura-con-${sufijo}@example.com`,
      sinAcceso: `sinacceso-con-${sufijo}@example.com`,
      ajena: `ajena-con-${sufijo}@example.com`,
    }
    const visitante = `Visitante ${sufijo}`
    const orgs: string[] = []
    const usuarios: string[] = []
    try {
      const [org, otra] = await rest<{ id: string }>('organizaciones', [{ nombre: `E2E consultas ${sufijo}` }, { nombre: `E2E ajena ${sufijo}` }])
      orgs.push(org.id, otra.id)
      const [{ id: empresaId }] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: empresa, correo: correoAvisos }, 'dominio')
      await rest('tiendas', { organizacion_id: org.id, empresa_id: empresaId, dominio: host }, 'dominio')
      await rest('empresas', { organizacion_id: otra.id, nombre: `Ajena ${sufijo}` }, 'dominio')

      // Tres roles de la organización de la tienda (consultas: administrador=Editar, consulta=Lectura,
      // mostrador=Ninguno) y un administrador de OTRA organización.
      const asignaciones: Array<[string, string, string]> = [
        [correos.admin, org.id, 'administrador'],
        [correos.lectura, org.id, 'consulta'],
        [correos.sinAcceso, org.id, 'mostrador'],
        [correos.ajena, otra.id, 'administrador'],
      ]
      for (const [correo, organizacion, rol] of asignaciones) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', { user_id: id, organizacion_id: organizacion, rol_id: rol })
      }

      // SC-004: desde que la tienda envía hasta que la bandeja la muestra pasan menos de 5 s.
      const contextoAdmin = await browser.newContext()
      const admin = await contextoAdmin.newPage()
      await ingresar(admin, correos.admin)
      await admin.goto('/consultas')
      const inicio = Date.now()
      const consultaId = await enviarConsultaPublica(host, visitante, 'Hola, ¿tienen stock?')
      await admin.reload()
      const fila = admin.getByRole('row', { name: new RegExp(visitante) })
      await expect(fila).toBeVisible({ timeout: LIMITE_BANDEJA_MS })
      expect(Date.now() - inicio).toBeLessThan(LIMITE_BANDEJA_MS)

      // SC-008: el aviso llega a la dirección de la empresa y su enlace abre el detalle de ESA consulta.
      await barrerAvisos()
      const enlace = await enlaceDelAviso(correoAvisos, empresa)
      expect(enlace).toContain(`consulta=${consultaId}`)
      expect(enlace).not.toContain(encodeURIComponent(visitante))
      await admin.goto(new URL(enlace).pathname + new URL(enlace).search)
      const detalle = admin.getByRole('dialog', { name: `Consulta de ${visitante}` })
      await expect(detalle).toBeVisible()

      // Administrador (consultas=Editar): asigna, anota y resuelve.
      await detalle.getByLabel('Responsable').click()
      await admin.getByRole('option').filter({ hasNotText: 'Sin responsable' }).first().click()
      await detalle.getByLabel('Nota interna').fill('Se respondió por correo.')
      await detalle.getByLabel('Estado').click()
      await admin.getByRole('option', { name: 'Resuelta', exact: true }).click()
      await detalle.getByRole('button', { name: 'Guardar' }).click()
      await expect(admin.getByText(`Consulta guardada · ${visitante}`)).toBeVisible()
      await contextoAdmin.close()

      // Rol Consulta (Lectura): ve el detalle con lo guardado, sin poder cambiarlo.
      const contextoLectura = await browser.newContext()
      const lectura = await contextoLectura.newPage()
      await ingresar(lectura, correos.lectura)
      await lectura.goto(`/consultas?consulta=${consultaId}`)
      const detalleLectura = lectura.getByRole('dialog', { name: `Consulta de ${visitante}` })
      await expect(detalleLectura).toBeVisible()
      await expect(detalleLectura.getByText('Se respondió por correo.')).toBeVisible()
      await expect(detalleLectura.getByRole('button', { name: 'Guardar' })).toHaveCount(0)
      await expect(detalleLectura.getByLabel('Nota interna')).toBeDisabled()
      await contextoLectura.close()

      // Rol Mostrador (Ninguno): Acceso restringido y sin Consultas en el menú.
      const contextoSin = await browser.newContext()
      const sin = await contextoSin.newPage()
      await ingresar(sin, correos.sinAcceso)
      await sin.goto('/consultas')
      await expect(sin.getByText('Acceso restringido')).toBeVisible()
      await expect(sin.getByText(visitante)).toHaveCount(0)
      await contextoSin.close()

      // Otra organización: ni la bandeja ni el enlace del correo revelan la consulta.
      const contextoAjena = await browser.newContext()
      const ajena = await contextoAjena.newPage()
      await ingresar(ajena, correos.ajena)
      await ajena.goto(`/consultas?consulta=${consultaId}`)
      await expect(ajena.getByText(visitante)).toHaveCount(0)
      await expect(ajena.getByRole('dialog', { name: `Consulta de ${visitante}` })).toHaveCount(0)
      await contextoAjena.close()
    } finally {
      // Borrar la organización arrastra por `on delete cascade` dominio.empresas, tiendas, consultas,
      // consultas_avisos y consultas_configuracion (ver las migraciones 20261013120000, 20261023100000 y 202610242*).
      for (const org of orgs) await borrar(`organizaciones?id=eq.${org}`)
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
