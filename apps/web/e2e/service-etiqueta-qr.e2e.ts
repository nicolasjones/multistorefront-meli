import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { leerQr } from '../src/lib/qr/qr.lector.test-util'
import { altaUsuario, borrar, borrarUsuario, leer, rest, serviceKey, url } from './soporte/fixtures'

// F-SVC-32 (MSF-190, SC-005): etiqueta con código QR. La persona del taller abre la etiqueta desde el detalle; el QR que
// se dibuja en pantalla se decodifica en el test (con el lector de pruebas, desde el `<path>` del DOM) y tiene que ser
// EXACTAMENTE la ruta de la reparación; la etiqueta no muestra datos personales; la hoja de impresión sale del tamaño
// elegido (se genera el PDF de Chromium y se lee su `MediaBox` y su cantidad de páginas); y, abierto sin sesión, el QR pasa
// por el ingreso y vuelve a la reparación (FR-050). Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra
// con la API admin desde Node. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite: ver docs/e2e-app.md y
// docs/service-etiqueta-qr.md. En el CI corre en el job `e2e-tienda`.

const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'
const MM_A_PUNTOS = 72 / 25.4

// Llama a una RPC con la sesión de la persona (no la service-role), como lo haría la app.
async function rpcComo<T>(token: string, nombre: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) throw new Error(`${nombre}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T
}

async function tokenDe(correo: string): Promise<string> {
  const sesion = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!sesion.ok) throw new Error(`login de ${correo}: ${sesion.status} ${await sesion.text()}`)
  return ((await sesion.json()) as { access_token: string }).access_token
}

async function iniciarSesion(page: Page, correo: string) {
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

// Reconstruye la matriz del QR desde el `<path>` que está en la página (lo mismo que ve el lector de un celular) y la decodifica.
async function decodificarQr(page: Page): Promise<string> {
  const svg = page.getByRole('img', { name: /^Código QR de la reparación R-/ })
  await expect(svg).toBeVisible()
  const lado = Number((await svg.getAttribute('viewBox'))!.split(' ')[2])
  const d = (await svg.locator('path').getAttribute('d'))!
  const raster = Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false))
  for (const [, x, y, largo] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(largo); i++) raster[Number(y)][Number(x) + i] = true
  return leerQr(raster.slice(4, lado - 4).map((fila) => fila.slice(4, lado - 4))).texto
}

test.describe('Service técnico · etiqueta con código QR (MSF-190, SC-005)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-190:T008,T009,T011] etiqueta sin datos personales, QR exacto, hoja del tamaño elegido y acceso por el ingreso', async ({ browser }) => {
    test.setTimeout(120_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-etiqueta-${sufijo}@example.com`
    const tienda = `Tienda etiqueta ${sufijo}`
    const secretos = [`Cliente Secreto ${sufijo}`, `Falla secreta ${sufijo}`, `SERIE-SECRETA-${sufijo}`, '11 5555-0000']
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E etiqueta ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: tienda }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, nombre: secretos[0], tipo: 'minorista' })
      const [modelo] = await leer<{ id: string }>(`modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, 'dominio')

      const token = await tokenDe(correo)
      const { id: reparacionId } = await rpcComo<{ id: string }>(token, 'crear_reparacion', {
        p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_falla: secretos[1], p_numero_serie: secretos[2], p_contacto: secretos[3],
      })

      // 1) Desde el detalle, «Imprimir etiqueta» abre la etiqueta.
      const contexto = await browser.newContext()
      const page = await contexto.newPage()
      await page.goto('/login')
      await iniciarSesion(page, correo)
      await expect(page).not.toHaveURL(/\/login/)
      await page.goto(`/service-tecnico/reparaciones/${reparacionId}`)
      await page.getByRole('link', { name: 'Imprimir etiqueta' }).click()
      await expect(page).toHaveURL(new RegExp(`/service-tecnico/reparaciones/${reparacionId}/etiqueta$`))
      await expect(page.getByRole('heading', { name: /^Etiqueta de la reparación R-\d+$/ })).toBeVisible()

      // 2) El QR decodificado es EXACTAMENTE la ruta de la reparación (con el origen del panel) y nada más.
      const origen = new URL(page.url()).origin
      const destino = `${origen}/service-tecnico/reparaciones/${reparacionId}`
      expect(await decodificarQr(page)).toBe(destino)

      // 3) La etiqueta lleva solo código, tienda, equipo e ingreso: ningún dato personal en toda la página.
      const etiqueta = page.locator('.etiqueta-copia').first()
      await expect(etiqueta).toContainText(tienda)
      await expect(etiqueta).toContainText(/Ingreso \d{2}\/\d{2}\/\d{4}/)
      const cuerpo = await page.locator('body').innerText()
      for (const prohibido of secretos) expect(cuerpo).not.toContain(prohibido)
      expect(await page.content()).not.toContain('/seguimiento/')

      // 4) La hoja de impresión mide lo elegido y sale una etiqueta por página (PDF de Chromium con el CSS de impresión).
      await page.getByLabel('Cantidad de etiquetas').fill('3')
      await page.emulateMedia({ media: 'print' })
      await expect(page.getByRole('button', { name: 'Imprimir' })).toBeHidden() // lo marcado `.no-imprimir` no sale
      await expect(etiqueta).toBeVisible()
      const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
      const caja = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf)
      expect(caja, 'el PDF trae su MediaBox').not.toBeNull()
      expect(Number(caja![1])).toBeCloseTo(50 * MM_A_PUNTOS, 0)
      expect(Number(caja![2])).toBeCloseTo(30 * MM_A_PUNTOS, 0)
      expect(pdf.match(/\/Type\s*\/Page\b(?!s)/g)?.length).toBe(3)

      // 5) El tamaño elegido se recuerda al volver a abrir la etiqueta.
      await page.emulateMedia({ media: 'screen' })
      await page.getByRole('combobox', { name: 'Tamaño de la etiqueta' }).click()
      await page.getByRole('option', { name: 'Grande · 70 × 40 mm' }).click()
      await page.reload()
      await expect(page.getByRole('combobox', { name: 'Tamaño de la etiqueta' })).toContainText('Grande · 70 × 40 mm')
      await contexto.close()

      // 6) Abierto sin sesión, el QR pasa por el ingreso y vuelve a la reparación (FR-050, amenaza 3.3).
      const anonimo = await browser.newContext()
      const celular = await anonimo.newPage()
      await celular.goto(destino)
      await expect(celular).toHaveURL(/\/login\?to=/)
      await iniciarSesion(celular, correo)
      await expect(celular).toHaveURL(new RegExp(`/service-tecnico/reparaciones/${reparacionId}$`))
      await expect(celular.getByRole('heading', { name: /^Reparación R-\d+$/ })).toBeVisible()
      await anonimo.close()
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
