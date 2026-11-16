import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from './fixture'
import { borrar, borrarUsuario, altaUsuario, rest, leer, serviceKey, sql, url } from './soporte/fixtures'

// MSF-952 · S-1 de MSF-118: el aviso de estado de la reparación que manda el servidor por WhatsApp. Recorre el
// consentimiento en la ficha del cliente y el botón «Avisar por WhatsApp» del detalle, y verifica en la base el aviso
// `pendiente` con `canal = 'whatsapp'` y su orden en la outbox. El envío real al proveedor no se prueba: el proveedor
// todavía no está contratado (D-1 de MSF-118); el flow lo cierra como fallido. Requiere el stack local
// (`pnpm dev:supabase`); sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite. Ver docs/service-avisos.md.
const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'

async function rpcComo(correo: string, nombre: string, cuerpo: Record<string, unknown>): Promise<unknown> {
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!sesion.ok) throw new Error(`login de ${correo}: ${sesion.status} ${await sesion.text()}`)
  const { access_token } = (await sesion.json()) as { access_token: string }
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`rpc ${nombre}: ${r.status} ${await r.text()}`)
  const texto = await r.text()
  return texto ? JSON.parse(texto) : null
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Service técnico · aviso por WhatsApp desde el servidor (MSF-952)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-952:S1] consentimiento en la ficha y aviso de WhatsApp encolado desde el detalle', async ({ page }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-whatsapp-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E WhatsApp ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await sql(`insert into public.features (id, nombre, descripcion) values ('service-tecnico', 'Service técnico', 'E2E') on conflict do nothing`)
      await sql(`insert into public.organizaciones_features (feature_id, organizacion_id, habilitado_por) values ('service-tecnico', $1, $2)`, [org.id, userId])
      // El aviso de WhatsApp reusa la conexión de los avisos por correo: sin ella la RPC responde «sin_conexion».
      await sql(`insert into public.conexiones (organizacion_id, sistema_externo, credencial_vault_id) values ($1, 'comprobantes-pdf', $2)`, [org.id, randomUUID()])
      const [cliente] = await rest<{ id: string }>(
        'clientes',
        { organizacion_id: org.id, nombre: `Cliente ${sufijo}`, tipo: 'minorista', celular: '11 2233-4455' },
        'dominio',
      )
      const modelos = await leer<{ id: string }>('modelos_equipo?organizacion_id=eq.' + org.id + '&select=id&limit=1', 'dominio')
      if (!modelos[0]) throw new Error('La organización no tiene modelos de equipo sembrados.')
      const reparacion = (await rpcComo(correo, 'crear_reparacion', {
        p_empresa_id: empresa.id,
        p_cliente_id: cliente.id,
        p_modelo_id: modelos[0].id,
        p_falla: 'No enciende',
      })) as { id: string }

      await ingresar(page, correo)

      // El consentimiento se enciende desde la ficha del cliente y la base guarda la fecha.
      await page.goto(`/clientes/show/${cliente.id}`)
      const interruptor = page.getByLabel('Acepta avisos por WhatsApp')
      await expect(interruptor).not.toBeChecked()
      await interruptor.click()
      await expect(interruptor).toBeChecked()
      await expect
        .poll(async () => (await leer<{ acepta_whatsapp_en: string | null }>(`clientes?id=eq.${cliente.id}&select=acepta_whatsapp_en`, 'dominio'))[0]?.acepta_whatsapp_en)
        .not.toBeNull()

      // El detalle encola el aviso del estado actual por WhatsApp (el servidor lo manda).
      await page.goto(`/service-tecnico/reparaciones/${reparacion.id}`)
      await page.getByRole('button', { name: 'Avisar por WhatsApp' }).click()
      await expect(page.getByText('Aviso por WhatsApp enviado al cliente')).toBeVisible()
      const avisos = await leer<{ canal: string; estado_envio: string; destinatario: string }>(
        `reparacion_avisos?reparacion_id=eq.${reparacion.id}&select=canal,estado_envio,destinatario`,
        'dominio',
      )
      expect(avisos).toHaveLength(1)
      expect(avisos[0]).toMatchObject({ canal: 'whatsapp', estado_envio: 'pendiente', destinatario: '5491122334455' })
      const ordenes = await sql<{ clave: string }>(
        `select clave from public.capacidades_ejecucion where organizacion_id = $1 and clave like 'enviar-aviso-whatsapp-%'`,
        [org.id],
      )
      expect(ordenes.length).toBe(1)
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
