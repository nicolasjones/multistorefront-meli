import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'

// Utilidades comunes de las capturas de la documentación de usuario. Ninguna captura modifica datos: se abren y se
// completan formularios y diálogos, pero nunca se confirman. Usan el dataset demo (docs/dataset-demo.md).
//
// Variables: SUPABASE_URL y SUPABASE_ANON_KEY (para leer ids como el propio usuario), CAPTURAS_DESTINO (carpeta de las
// imágenes; por defecto `docs/producto/img`), DEMO_SUFIJO (opcional, organización demo paralela).
export const URL_API = process.env.SUPABASE_URL
export const ANON = process.env.SUPABASE_ANON_KEY
export const SUFIJO = process.env.DEMO_SUFIJO ?? ''
export const PASSWORD = 'Demo-Msf-2026!'
export const DESTINO = path.resolve(process.cwd(), process.env.CAPTURAS_DESTINO ?? '../../docs/producto/img')

export type Rol = 'admin' | 'operador' | 'mostrador' | 'deposito' | 'administracion' | 'tecnico' | 'consulta'
export const correoDe = (rol: Rol) => `${rol}${SUFIJO}@demo.msf.test`

export async function ingresar(page: Page, rol: Rol = 'admin') {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correoDe(rol))
  await page.getByLabel('Contraseña').fill(PASSWORD)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Lee datos como el usuario del rol indicado (el esquema `dominio` solo admite usuarios autenticados). Sirve para
// resolver ids (un comprobante, una reparación…) y armar la ruta de una pantalla de detalle.
export async function leer<T = Record<string, unknown>>(rol: Rol, ruta: string, perfil = 'public'): Promise<T[]> {
  const t = await fetch(`${URL_API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ email: correoDe(rol), password: PASSWORD }),
  })
  const { access_token: token } = (await t.json()) as { access_token: string }
  const r = await fetch(`${URL_API}/rest/v1/${ruta}`, { headers: { apikey: ANON ?? '', authorization: `Bearer ${token}`, 'accept-profile': perfil } })
  if (!r.ok) throw new Error(`lectura ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

// Espera a que la pantalla cargue (título + red quieta) antes de capturar.
export async function irA(page: Page, ruta: string) {
  await page.goto(ruta)
  await expect(page.getByRole('heading', { level: 1 }).first(), `${ruta} no mostró su título`).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
}

// Guarda el PNG en <DESTINO>/<guía>/<nombre>.png. Sin animaciones ni cursor: dos corridas dan la misma imagen.
export async function capturar(destino: Page | Locator, guia: string, nombre: string) {
  const carpeta = path.join(DESTINO, guia)
  mkdirSync(carpeta, { recursive: true })
  await destino.screenshot({ path: path.join(carpeta, `${nombre}.png`), animations: 'disabled', caret: 'hide' })
}

// Recuadro de color (y número de paso opcional) sobre un elemento, para indicar «hacé clic acá». Se dibuja en una capa
// aparte, sin tocar la pantalla. `quitarResaltados` los borra antes de la siguiente captura.
export async function resaltar(page: Page, objetivo: Locator, numero?: number) {
  const caja = await objetivo.first().boundingBox()
  if (!caja) throw new Error('resaltar: el elemento no está visible')
  await page.evaluate(({ c, n }) => {
    const capa = document.createElement('div')
    capa.setAttribute('data-resaltado', '1')
    capa.style.cssText = `position:fixed;left:${c.x - 4}px;top:${c.y - 4}px;width:${c.width + 8}px;height:${c.height + 8}px;border:3px solid #e11d48;border-radius:8px;pointer-events:none;z-index:2147483647;box-shadow:0 0 0 2px rgba(255,255,255,.85)`
    if (n) {
      const b = document.createElement('div')
      b.textContent = String(n)
      b.style.cssText = 'position:absolute;left:-14px;top:-14px;width:26px;height:26px;border-radius:50%;background:#e11d48;color:#fff;font:700 14px/26px sans-serif;text-align:center;box-shadow:0 0 0 2px #fff'
      capa.appendChild(b)
    }
    document.body.appendChild(capa)
  }, { c: caja, n: numero })
}
export async function quitarResaltados(page: Page) {
  await page.evaluate(() => document.querySelectorAll('[data-resaltado]').forEach((e) => e.remove()))
}

// Oculta (visibility:hidden) lo que no debe verse en un manual (p. ej. un texto con jerga interna): ver el backlog.
export async function ocultar(objetivo: Locator) {
  await objetivo.evaluateAll((els) => els.forEach((e) => { (e as HTMLElement).style.visibility = 'hidden' })).catch(() => {})
}

// Combo de MUI (Autocomplete o Select): se abre por su nombre accesible y se elige la opción (la lista vive en un portal).
export async function elegir(page: Page, etiqueta: string | RegExp, opcion: string | RegExp, ambito: Page | Locator = page) {
  await ambito.getByRole('combobox', { name: etiqueta, exact: typeof etiqueta === 'string' }).first().click()
  await page.getByRole('option', { name: opcion }).first().click()
}
