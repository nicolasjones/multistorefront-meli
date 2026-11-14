import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { CONTRASENA_E2E, altaUsuario, borrar, borrarUsuario, leer, limpiarOrganizacion, rest, serviceKey, url } from './soporte/fixtures'

// MSF-855: si falla el repedido de permisos con un formulario largo abierto (misma clave usuario:organización), la
// pantalla conserva el borrador, queda INERTE (nada se guarda ni se edita), avisa con «Reintentar» y, al reintentar con
// éxito, habilita sin perder lo tipeado. El cambio de organización (otra clave) se cubre en Vitest con el provider real
// (`RequiereAccesoSeccion.borrador.test.tsx`): en E2E exigiría un superadmin entrando a otra organización.
// Requiere el stack local (docs/e2e-app.md); se omite sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(CONTRASENA_E2E)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Permisos que se vuelven a pedir con un formulario abierto (MSF-855)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('falla el repedido: formulario inerte con aviso y borrador; «Reintentar» con éxito lo habilita sin perder lo tipeado', async ({ browser }) => {
    test.setTimeout(180_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-borrador-${sufijo}@example.com`
    const nombre = `Joystick ${sufijo}`
    let orgId: string | undefined
    let idUsuario: string | undefined
    const contexto = await browser.newContext()
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E borrador ${sufijo}` })
      orgId = org.id
      const empresas = await rest<{ id: string; nombre: string }>(
        'empresas',
        [
          { organizacion_id: org.id, nombre: `Tienda A ${sufijo}`, activa: true },
          { organizacion_id: org.id, nombre: `Tienda B ${sufijo}`, activa: true },
        ],
        'dominio',
      )
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])

      const page = await contexto.newPage()
      // Solo se falla el repedido (la segunda llamada en adelante, mientras `fallar` esté activo).
      let fallar = false
      let pedidosPermisos = 0
      // El repedido que falla queda retenido hasta que el spec lo suelte: cambiar la empresa activa remonta la pantalla
      // (a propósito: no arrastra datos de la empresa anterior), así que la persona escribe DESPUÉS del remonte, con el
      // pedido todavía en vuelo, y el fallo llega con el formulario ya abierto.
      let soltar: () => void = () => {}
      let retener = new Promise<void>((resolver) => { soltar = resolver })
      await page.route('**/rest/v1/rpc/permisos_actuales*', async (ruta) => {
        pedidosPermisos += 1
        if (!fallar) return ruta.continue()
        await retener
        return ruta.abort()
      })
      let altas = 0
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/rest\/v1\/(rpc\/)?(crear_producto|productos)/.test(r.url())) altas += 1
      })
      await ingresar(page, correo)

      await page.goto('/productos/create')
      const campo = page.getByRole('textbox', { name: 'Nombre', exact: true })
      await expect(campo).toBeVisible({ timeout: 60_000 })

      // Cambiar la empresa activa vuelve a pedir los permisos (misma clave usuario:organización); el pedido queda en vuelo.
      fallar = true
      await page.getByRole('button', { name: /^Empresa activa:/ }).click()
      await page.getByRole('menuitem', { name: new RegExp(empresas[1].nombre) }).click()
      await expect(page.getByRole('button', { name: /^Empresa activa:/ })).toContainText(empresas[1].nombre)
      await expect(campo).toBeVisible()
      await campo.fill(nombre)
      await campo.evaluate((el) => el.setAttribute('data-e2e-marca', 'mismo-nodo'))
      const precio = page.getByLabel('Precio de lista (sin IVA)')
      await precio.fill('10')
      await expect(page.getByRole('button', { name: 'Crear producto' })).toBeEnabled()
      const caido = page.waitForEvent('requestfailed', (r) => r.url().includes('/rpc/permisos_actuales'))
      soltar()
      await caido

      // Aviso no bloqueante, en una región viva; formulario conservado (mismo nodo, mismo texto) e inerte.
      const aviso = page.getByRole('note').filter({ hasText: 'No pudimos verificar tus permisos.' })
      await expect(aviso).toBeVisible()
      expect(await aviso.evaluate((el) => Boolean(el.closest('[aria-live="polite"]')))).toBe(true)
      await expect(campo).toHaveAttribute('data-e2e-marca', 'mismo-nodo')
      await expect(campo).toHaveValue(nombre)
      await expect(campo).toBeDisabled()
      await expect(precio).toBeDisabled()
      await expect(precio).toHaveValue('10')
      await expect(page.getByRole('button', { name: 'Crear producto' })).toBeDisabled()
      expect(await campo.evaluate((el) => Boolean(el.closest('fieldset[inert]')))).toBe(true)
      // Ni con un clic forzado se envía nada.
      await page.getByRole('button', { name: 'Crear producto' }).click({ force: true, timeout: 5_000 }).catch(() => undefined)
      await page.waitForTimeout(500)
      expect(altas).toBe(0)

      // «Reintentar» con el pedido todavía caído: sigue inerte y no hay bucle (un pedido por clic).
      const antes = pedidosPermisos
      const caidoOtra = page.waitForEvent('requestfailed', (r) => r.url().includes('/rpc/permisos_actuales'))
      await aviso.getByRole('button', { name: 'Reintentar' }).focus()
      await page.keyboard.press('Enter')
      await caidoOtra
      await expect(campo).toBeDisabled()
      await expect(campo).toHaveValue(nombre)
      await page.waitForTimeout(3_000)
      expect(pedidosPermisos).toBe(antes + 1)

      // Vuelve la red: «Reintentar» confirma el nivel, habilita y conserva lo tipeado; ahora sí se guarda.
      fallar = false
      retener = Promise.resolve()
      await aviso.getByRole('button', { name: 'Reintentar' }).click()
      await expect(aviso).toHaveCount(0)
      await expect(campo).toBeEnabled()
      await expect(campo).toHaveAttribute('data-e2e-marca', 'mismo-nodo')
      await expect(campo).toHaveValue(nombre)
      await expect(precio).toBeEnabled()
      await expect(precio).toHaveValue('10')
      await page.getByRole('button', { name: 'Crear producto' }).click()
      await expect(page.getByText(`${nombre} quedó activo en el catálogo.`)).toBeVisible()
      const guardados = await leer<{ id: string }>(`productos?organizacion_id=eq.${org.id}&nombre=eq.${encodeURIComponent(nombre)}&select=id`, 'dominio')
      expect(guardados).toHaveLength(1)
    } finally {
      await contexto.close()
      if (idUsuario) await borrar(`usuario_empresa_activa?user_id=eq.${idUsuario}`)
      if (orgId) await limpiarOrganizacion(orgId)
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
