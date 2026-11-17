import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, test } from './fixture'
import { UPSERT_FUSIONAR, borrar, cabeceras, leer, rest, serviceKey, url } from './soporte/fixtures'

// Newsletter de la tienda (spec newsletter-de-la-tienda, T009): axe (WCAG 2 A y AA) del formulario del pie y de la página de
// confirmación `/newsletter/confirmar/:token` a 320, 768 y 1440 px, sin desborde horizontal. Usa la tienda del seed
// (mundojc.localhost), enciende la bandera `newsletter` y el interruptor de la tienda para la corrida y devuelve ambos a su valor
// previo. Requiere el stack local (`pnpm dev:supabase`) y la web servida. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite.

const TIENDA = { host: 'mundojc.localhost', organizacion: '0f5eed00-0000-4000-8000-000000000001', empresa: '0f5eed01-0000-4000-8000-000000000001' } as const
const ANCHOS = [320, 768, 1440] as const
const puerto = new URL(process.env.E2E_BASE_URL ?? `http://localhost:${Number(process.env.WEB_PORT) || 4300}`).port

async function fijarBandera(activa: boolean): Promise<boolean | null> {
  const ruta = 'banderas_plataforma?clave=eq.newsletter'
  const lectura = await fetch(`${url}/rest/v1/${ruta}&select=activa`, { headers: cabeceras({ 'accept-profile': 'public' }) })
  // Un error HTTP no es «la bandera no existe»: falla fuerte para no seguir con un estado desconocido.
  if (!lectura.ok) throw new Error(`lectura de la bandera newsletter: ${lectura.status} ${await lectura.text()}`)
  const filas = (await lectura.json()) as { activa: boolean }[]
  if (filas.length === 0) return null
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'PATCH', headers: cabeceras({ 'content-profile': 'public' }), body: JSON.stringify({ activa }) })
  if (!r.ok) throw new Error(`bandera newsletter: ${r.status} ${await r.text()}`)
  return filas[0].activa
}

type ResultadoAxe = { violations: { id: string; nodes: { target: unknown[] }[] }[] }
type AxeEnVentana = { axe: { run: (contexto: Document | { include: string[][] }, opciones: unknown) => Promise<ResultadoAxe> } }

async function violacionesAxe(page: Page, selector?: string): Promise<string[]> {
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve('axe-core') })
  return page.evaluate(async (incluir) => {
    const axe = (window as unknown as AxeEnVentana).axe
    const resultado = await axe.run(incluir ? { include: [[incluir]] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })
    return resultado.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  }, selector)
}

const sinDesborde = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test.describe('Tienda · newsletter: accesibilidad a 320, 768 y 1440 px', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  test.describe.configure({ mode: 'serial' })

  let banderaPrevia: boolean | null = null
  // `null` hasta que la lectura previa de la configuración tuvo éxito: sin ella no se restaura ni se borra nada.
  let configuracionPrevia: { activo: boolean }[] | null = null

  test.beforeAll(async () => {
    banderaPrevia = await fijarBandera(true)
    test.skip(banderaPrevia === null, 'La base no tiene la bandera `newsletter`.')
    configuracionPrevia = await leer<{ activo: boolean }>(`newsletter_configuracion?select=activo&empresa_id=eq.${TIENDA.empresa}`, 'dominio')
    await rest(
      'newsletter_configuracion?on_conflict=empresa_id',
      [{ empresa_id: TIENDA.empresa, organizacion_id: TIENDA.organizacion, activo: true }],
      'dominio',
      UPSERT_FUSIONAR,
    )
  })

  // Restauración en `afterAll`: la bandera y el interruptor vuelven a su valor previo aunque un test falle.
  test.afterAll(async () => {
    if (banderaPrevia === null) return
    try {
      if (configuracionPrevia !== null) {
        if (configuracionPrevia.length === 0) await borrar(`newsletter_configuracion?empresa_id=eq.${TIENDA.empresa}`, 'dominio')
        else await rest('newsletter_configuracion?on_conflict=empresa_id', [{ empresa_id: TIENDA.empresa, organizacion_id: TIENDA.organizacion, activo: configuracionPrevia[0].activo }], 'dominio', UPSERT_FUSIONAR)
      }
    } finally {
      await fijarBandera(banderaPrevia)
    }
  })

  for (const ancho of ANCHOS) {
    test(`formulario del pie y página de confirmación sin violaciones de axe a ${ancho} px`, async ({ browser }) => {
      const contexto = await browser.newContext({ viewport: { width: ancho, height: 900 } })
      const page = await contexto.newPage()
      try {
        const origen = `http://${TIENDA.host}:${puerto}`

        // 1) Formulario del pie: vacío y con los errores de validación a la vista.
        await page.goto(`${origen}/`)
        const pie = page.getByTestId('pie-newsletter')
        await pie.scrollIntoViewIfNeeded()
        await expect(pie.getByRole('heading', { name: 'Newsletter' })).toBeVisible()
        expect(await violacionesAxe(page, '#newsletter-suscripcion'), 'formulario vacío').toEqual([])
        await pie.getByRole('button', { name: 'Suscribirme' }).click()
        await expect(pie.locator('#newsletter-correo-error')).toBeVisible()
        expect(await violacionesAxe(page, '#newsletter-suscripcion'), 'formulario con errores').toEqual([])
        expect(await sinDesborde(page), 'el formulario no desborda').toBe(true)

        // 2) Página de confirmación con un enlace inválido (no hace falta sembrar suscriptores).
        await page.goto(`${origen}/newsletter/confirmar/${'x'.repeat(43)}`)
        await expect(page.getByTestId('newsletter-confirmacion')).toBeVisible()
        expect(await violacionesAxe(page), 'confirmación').toEqual([])
        expect(await sinDesborde(page), 'la confirmación no desborda').toBe(true)
      } finally {
        await contexto.close()
      }
    })
  }
})
