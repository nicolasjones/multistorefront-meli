import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { UPSERT_FUSIONAR, borrar, cabeceras, fijarBanderaPlataforma, leer, rest, serviceKey, url } from './soporte/fixtures'

// Newsletter de la tienda, recorrido completo de la persona (MSF-978, spec newsletter-de-la-tienda): suscribirse desde el pie
// → registro `pendiente` con su consentimiento → confirmar con el enlace del correo → darse de baja con el enlace de baja →
// volver a suscribirse. Usa la tienda del seed (mundojc.localhost), enciende la bandera `newsletter` y el interruptor de la
// tienda para la corrida y devuelve ambos a su valor previo.
//
// NO envía ni lee correo: el CI no tiene SMTP ni Kestra. El token del correo lo genera el flow `newsletter-confirmaciones` y de
// la base solo queda su SHA-256; por eso el test hace de «flow»: genera un token propio y guarda su hash en la fila del suscriptor
// por la REST con la service-role (solo desde Node; la clave nunca llega al navegador). La baja usa el enlace
// `/newsletter/baja/:token`, que llama a la Edge Function `baja-correo-masivo`; el stack del CI no corre funciones Edge, así que
// el test intercepta ese pedido y reproduce lo que la función hace (SHA-256 del token y RPC `dar_de_baja_correo_masivo`), de modo
// que la página y la base reales sí se ejercitan. Quedan fuera: el SMTP real, la publicación de los flows en Kestra y la
// Edge Function desplegada (ver docs/newsletter.md). Requiere el stack local (`pnpm dev:supabase`) y la web servida. Sin
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite.

const TIENDA = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' } as const
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port
const origen = `http://${TIENDA.host}:${puerto}`

// Datos únicos por corrida: la marca va en el correo y permite limpiar sin tocar a nadie más.
const MARCA = `e2e-nl-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
const correoDe = (nombre: string) => `${nombre}-${MARCA}@example.com`

const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex')
const tokenNuevo = () => randomBytes(32).toString('hex')

type Suscriptor = { id: string; correo: string; estado: string; version_consentimiento: string; confirmacion_hash: string | null; confirmacion_solicitada_en: string | null; confirmado_en: string | null; baja_en: string | null }
const COLUMNAS = 'id,correo,estado,version_consentimiento,confirmacion_hash,confirmacion_solicitada_en,confirmado_en,baja_en'

async function suscriptorDe(correo: string): Promise<Suscriptor | undefined> {
  const filas = await leer<Suscriptor>(`newsletter_suscriptores?select=${COLUMNAS}&empresa_id=eq.${TIENDA.empresa}&correo=eq.${encodeURIComponent(correo)}`, 'dominio')
  return filas[0]
}

async function actualizarSuscriptor(correo: string, cambios: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/newsletter_suscriptores?empresa_id=eq.${TIENDA.empresa}&correo=eq.${encodeURIComponent(correo)}`, {
    signal: AbortSignal.timeout(30_000),
    method: 'PATCH',
    headers: cabeceras({ 'content-profile': 'dominio' }),
    body: JSON.stringify(cambios),
  })
  if (!r.ok) throw new Error(`PATCH newsletter_suscriptores: ${r.status} ${await r.text()}`)
}

const enHoras = (horas: number) => new Date(Date.now() + horas * 3_600_000).toISOString()

// Siembra un suscriptor ya existente (lo que dejaría un envío previo del flow) con el hash del token que el test conoce.
async function sembrarSuscriptor(correo: string, extra: Record<string, unknown>) {
  await rest(
    'newsletter_suscriptores',
    [{ organizacion_id: TIENDA.organizacion, empresa_id: TIENDA.empresa, correo, version_consentimiento: 'newsletter-v1', ...extra }],
    'dominio',
    'return=minimal',
  )
}

// El aviso de cookies puede tapar el pie: si aparece se decide («Rechazar») antes de interactuar, sin `force`. No en todos los
// stacks aparece: se espera un instante y, si no hay aviso, se sigue (igual que `tienda-newsletter-a11y`).
async function resolverAvisoCookies(page: Page) {
  const aviso = page.getByRole('region', { name: 'Aviso de cookies' })
  const aparecio = await aviso.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)
  if (!aparecio) return
  await aviso.getByRole('button', { name: 'Rechazar' }).click()
  await expect(aviso).toHaveCount(0)
}

async function suscribirseDesdeElPie(page: Page, correo: string) {
  await page.goto(`${origen}/`)
  await resolverAvisoCookies(page)
  const pie = page.getByTestId('pie-newsletter')
  await pie.scrollIntoViewIfNeeded()
  await expect(pie.getByRole('heading', { name: 'Newsletter' })).toBeVisible({ timeout: 15_000 })
  await pie.getByRole('textbox', { name: 'Correo electrónico' }).fill(correo)
  await pie.getByRole('checkbox', { name: /Acepto recibir novedades/ }).check()
  await pie.getByRole('button', { name: 'Suscribirme' }).click()
  await expect(page.getByTestId('newsletter-exito')).toHaveText('Te enviamos un correo para confirmar tu suscripción.')
}

// Reproduce la Edge Function `baja-correo-masivo` (que el stack del CI no corre): mismo contrato `{ token }` → `{ ok: true }`, con el
// SHA-256 del token y la RPC real. Devuelve los tokens recibidos para comprobar que la página llamó.
async function emularFuncionDeBaja(page: Page): Promise<string[]> {
  const recibidos: string[] = []
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
  await page.route('**/functions/v1/baja-correo-masivo', async (route) => {
    const pedido = route.request()
    if (pedido.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: 'ok' })
    const { token } = pedido.postDataJSON() as { token: string }
    recibidos.push(token)
    const r = await fetch(`${url}/rest/v1/rpc/dar_de_baja_correo_masivo`, {
      signal: AbortSignal.timeout(30_000),
      method: 'POST',
      headers: cabeceras({ 'content-profile': 'public' }),
      body: JSON.stringify({ p_token_hash: sha256(token) }),
    })
    return route.fulfill({ status: r.ok ? 200 : 500, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(r.ok ? { ok: true } : { error: 'no se pudo procesar la baja' }) })
  })
  return recibidos
}

test.describe('Tienda · newsletter: suscripción, confirmación y baja', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  test.describe.configure({ mode: 'serial' })

  let banderaPrevia: boolean | null = null
  // `null` hasta que la lectura previa de la configuración tuvo éxito: sin ella no se restaura ni se borra nada.
  let configuracionPrevia: { activo: boolean }[] | null = null
  let campanaId: string | null = null

  test.beforeAll(async () => {
    banderaPrevia = await fijarBanderaPlataforma('newsletter', true)
    test.skip(banderaPrevia === null, 'La base no tiene la bandera `newsletter`.')
    configuracionPrevia = await leer<{ activo: boolean }>(`newsletter_configuracion?select=activo&empresa_id=eq.${TIENDA.empresa}`, 'dominio')
    await rest(
      'newsletter_configuracion?on_conflict=empresa_id',
      [{ empresa_id: TIENDA.empresa, organizacion_id: TIENDA.organizacion, activo: true }],
      'dominio',
      UPSERT_FUSIONAR,
    )
    // El límite por visitante (5 por hora, compartido con contacto y WhatsApp) se cuenta por tienda: se parte de cero para que los
    // pedidos de otros specs de la corrida no dejen sin cupo a este (como `tienda-analitica`).
    await borrar(`tienda_envios?empresa_id=eq.${TIENDA.empresa}`, 'dominio')
  })

  // Limpieza en `afterAll`: se borran las filas de esta corrida y la bandera y el interruptor vuelven a su valor previo aunque falle un test.
  test.afterAll(async () => {
    if (banderaPrevia === null) return
    try {
      if (campanaId) await borrar(`campanas_correo?id=eq.${campanaId}`, 'dominio')
      await borrar(`newsletter_suscriptores?empresa_id=eq.${TIENDA.empresa}&correo=like.*-${MARCA}@example.com`, 'dominio')
      await borrar(`tienda_envios?empresa_id=eq.${TIENDA.empresa}`, 'dominio')
      if (configuracionPrevia !== null) {
        if (configuracionPrevia.length === 0) await borrar(`newsletter_configuracion?empresa_id=eq.${TIENDA.empresa}`, 'dominio')
        else await rest('newsletter_configuracion?on_conflict=empresa_id', [{ empresa_id: TIENDA.empresa, organizacion_id: TIENDA.organizacion, activo: configuracionPrevia[0].activo }], 'dominio', UPSERT_FUSIONAR)
      }
    } finally {
      await fijarBanderaPlataforma('newsletter', banderaPrevia)
    }
  })

  test('suscribirse desde el pie deja un registro pendiente y el enlace del correo lo confirma', async ({ page }) => {
    const correo = correoDe('alta')
    await suscribirseDesdeElPie(page, correo)

    await expect.poll(async () => (await suscriptorDe(correo))?.estado, { message: 'el registro nace pendiente' }).toBe('pendiente')
    const pendiente = await suscriptorDe(correo)
    expect(pendiente?.version_consentimiento, 'queda la versión del consentimiento aceptado').toBeTruthy()
    expect(pendiente?.confirmacion_solicitada_en, 'queda la confirmación por enviar').not.toBeNull()
    expect(pendiente?.confirmado_en, 'todavía sin confirmar').toBeNull()

    // Sin token confirmable (el correo lo manda el flow): el enlace de una dirección sin hash no confirma a nadie.
    await page.goto(`${origen}/newsletter/confirmar/${tokenNuevo()}`)
    await expect(page.getByTestId('newsletter-confirmacion')).toHaveAttribute('data-resultado', 'invalido')
    expect((await suscriptorDe(correo))?.estado, 'un enlace desconocido no confirma').toBe('pendiente')

    // El test hace de flow: emite un token propio y guarda su SHA-256 con el vencimiento de 48 h.
    const token = tokenNuevo()
    await actualizarSuscriptor(correo, { confirmacion_hash: sha256(token), confirmacion_vence: enHoras(48), confirmacion_enviada_en: new Date().toISOString() })

    await page.goto(`${origen}/newsletter/confirmar/${token}`)
    const resultado = page.getByTestId('newsletter-confirmacion')
    await expect(resultado).toHaveAttribute('data-resultado', 'ok', { timeout: 15_000 })
    await expect(resultado.getByRole('heading', { name: 'Listo, ya estás suscripto' })).toBeVisible()
    await expect.poll(async () => (await suscriptorDe(correo))?.estado, { message: 'el enlace confirma la suscripción' }).toBe('confirmado')
    expect((await suscriptorDe(correo))?.confirmado_en).not.toBeNull()

    // Un enlace ya usado responde igual de bien (idempotente).
    await page.goto(`${origen}/newsletter/confirmar/${token}`)
    await expect(page.getByTestId('newsletter-confirmacion')).toHaveAttribute('data-resultado', 'ok', { timeout: 15_000 })
  })

  test('un enlace de confirmación vencido no confirma y ofrece pedir otro', async ({ page }) => {
    const correo = correoDe('vencido')
    const token = tokenNuevo()
    await sembrarSuscriptor(correo, { estado: 'pendiente', confirmacion_hash: sha256(token), confirmacion_vence: enHoras(-1), confirmacion_solicitada_en: enHoras(-50), confirmacion_enviada_en: enHoras(-49) })

    await page.goto(`${origen}/newsletter/confirmar/${token}`)
    const resultado = page.getByTestId('newsletter-confirmacion')
    await expect(resultado).toHaveAttribute('data-resultado', 'vencido', { timeout: 15_000 })
    await expect(resultado.getByRole('heading', { name: 'El enlace venció' })).toBeVisible()
    await expect(resultado.getByRole('link', { name: 'Volver al pie de la tienda' })).toBeVisible()
    expect((await suscriptorDe(correo))?.estado, 'un enlace vencido no confirma').toBe('pendiente')
  })

  test('el enlace de baja da de baja al suscriptor y puede volver a suscribirse', async ({ page }) => {
    const correo = correoDe('baja')
    const tokenBaja = tokenNuevo()
    await sembrarSuscriptor(correo, { estado: 'confirmado', confirmado_en: new Date().toISOString() })
    const suscriptor = await suscriptorDe(correo)
    expect(suscriptor?.estado).toBe('confirmado')

    // Un envío previo dejó un destinatario con el hash del enlace de baja (el token en claro solo vive en el correo).
    const [campana] = await rest<{ id: string }>(
      'campanas_correo',
      [{ organizacion_id: TIENDA.organizacion, empresa_id: TIENDA.empresa, clave: randomUUID(), asunto: `Prueba ${MARCA}`, mensaje: 'Mensaje de prueba del E2E' }],
      'dominio',
    )
    campanaId = campana.id
    await rest(
      'campana_correo_destinatarios',
      [{ organizacion_id: TIENDA.organizacion, campana_id: campana.id, suscriptor_id: suscriptor?.id, correo, estado: 'pendiente', token_hashes: [sha256(tokenBaja)] }],
      'dominio',
      'return=minimal',
    )

    const recibidos = await emularFuncionDeBaja(page)
    await page.goto(`${origen}/newsletter/baja/${tokenBaja}`)
    // La página pide un clic: abrir el enlace no da de baja a nadie.
    await expect(page.getByRole('heading', { name: 'Darte de baja del newsletter' })).toBeVisible({ timeout: 15_000 })
    expect((await suscriptorDe(correo))?.estado, 'abrir el enlace no da de baja').toBe('confirmado')
    await page.getByRole('button', { name: 'Darme de baja' }).click()
    await expect(page.getByTestId('newsletter-baja')).toHaveAttribute('data-resultado', 'hecha', { timeout: 15_000 })
    expect(recibidos, 'la página llamó a la función con el token del enlace').toEqual([tokenBaja])

    await expect.poll(async () => (await suscriptorDe(correo))?.estado, { message: 'la baja queda en la base' }).toBe('baja')
    expect((await suscriptorDe(correo))?.baja_en).not.toBeNull()
    const destinatarios = await leer<{ estado: string; baja_en: string | null }>(`campana_correo_destinatarios?select=estado,baja_en&campana_id=eq.${campana.id}`, 'dominio')
    expect(destinatarios, 'el pendiente de la campaña se omite y la baja se atribuye a ella').toEqual([{ estado: 'omitido', baja_en: expect.any(String) }])

    // Quien se dio de baja puede volver a pedir la suscripción: queda pendiente de nueva confirmación (no recibe nada hasta confirmar).
    // Los tests anteriores ya gastaron el cupo de 5 por hora del visitante (suscribir y cada confirmación cuentan): se parte de cero.
    await borrar(`tienda_envios?empresa_id=eq.${TIENDA.empresa}`, 'dominio')
    await suscribirseDesdeElPie(page, correo)
    await expect.poll(async () => (await suscriptorDe(correo))?.estado, { message: 'la nueva suscripción vuelve a pendiente' }).toBe('pendiente')
  })

  test('un enlace de baja con forma inválida no llama a la función y muestra «Enlace inválido»', async ({ page }) => {
    const recibidos = await emularFuncionDeBaja(page)
    await page.goto(`${origen}/newsletter/baja/no-es-un-token`)
    await page.getByRole('button', { name: 'Darme de baja' }).click()
    await expect(page.getByTestId('newsletter-baja')).toHaveAttribute('data-resultado', 'invalida', { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Enlace inválido' })).toBeVisible()
    expect(recibidos).toEqual([])
  })
})
