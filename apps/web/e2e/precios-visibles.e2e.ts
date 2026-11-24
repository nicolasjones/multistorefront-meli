import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { altaUsuario, borrar, borrarUsuario, CONTRASENA_E2E, rest, serviceKey, url } from './soporte/fixtures'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'

// Lo que la persona ve del precio tiene que ser el que el sistema cobra.
// 1) El precio final con IVA se redondea al centavo, igual que el total del comprobante (lo dejó la
//    migración `20270507180200_aplicar_iva_al_centavo.sql`, ya en `dokploy`).
// 2) El texto del margen aclara que NO descuenta la comisión del canal: el formulario de producto
//    calcula (Precio − Costo) / Precio.
// 3) El dólar se muestra con los 4 decimales que guarda la base (`numeric(14,4)`), no truncado a 2.
//
// Requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde Node
// (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo
// se omite (no entra al CI público). Ver docs/e2e-app.md.
//
// Cifras (dólar 1.465,1234 · lista USD 20 · costo USD 12):
//   central $ 29.302,47 · costo $ 17.581,48 · margen (29.302,47 − 17.581,48) / 29.302,47 = 40 %
//   el dólar se ve «$ 1.465,1234» (con sus 4 decimales), no «$ 1.465,12».

const password = CONTRASENA_E2E

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('Precios visibles', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('el margen aclara que no incluye la comisión del canal y el dólar se muestra con sus 4 decimales', async ({ browser }, testInfo) => {
    test.setTimeout(300_000)
    const sufijo = randomUUID().slice(0, 8)
    const correo = `admin-msf720-${sufijo}@example.com`
    const nombre = `Producto USD ${sufijo}`

    let orgId: string | undefined
    let idUsuario: string | undefined
    const contexto = await abrirContextoGrabado(browser, testInfo, 'admin')
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E precios visibles ${sufijo}` })
      orgId = org.id
      idUsuario = await altaUsuario(correo)
      await rest('usuarios_organizacion', [{ user_id: idUsuario, organizacion_id: org.id, rol_id: 'administrador' }])
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}`, activa: true }, 'dominio')
      await rest('usuario_empresa_activa', [{ user_id: idUsuario, empresa_id: empresa.id }])
      // Cotización con 4 decimales: es lo que guarda la base (`numeric(14,4)`).
      await rest('cotizacion_inicial', { organizacion_id: org.id, valor: 1465.1234 }, 'dominio')

      await prepararPaginaVisible(contexto.page)
      await ingresar(contexto.page, correo)

      await paso(contexto.page, 'Abre el alta de producto y carga precio y costo en dólares', async () => {
        await contexto.page.goto('/productos/create')
        // La pantalla vuelve a pintar el formulario cuando terminan de cargar los permisos: se espera al bloque de precios.
        await expect(contexto.page.getByRole('region', { name: 'Precio y costo' })).toBeVisible()
        await escribir(contexto.page, contexto.page.getByRole('textbox', { name: 'Nombre', exact: true }), nombre)
        await clic(contexto.page, contexto.page.getByLabel('Moneda'))
        await clic(contexto.page, contexto.page.getByRole('option', { name: /USD|Dólar/ }))
        await escribir(contexto.page, contexto.page.getByLabel('Precio de lista (sin IVA)'), '20')
        await escribir(contexto.page, contexto.page.getByLabel('Costo', { exact: true }), '12')
      })

      await paso(contexto.page, 'El precio en pesos se calcula con el dólar completo', async () => {
        await expect(contexto.page.getByLabel('Precio en pesos')).toHaveValue('$ 29.302,47')
      })

      await rotulo(contexto.page, 'El dólar se muestra con los 4 decimales que guarda la base')
      await paso(contexto.page, 'El dólar aparece con sus 4 decimales, no truncado a 2', async () => {
        await expect(contexto.page.getByText(/con dólar \$ 1\.465,1234/)).toBeVisible()
      })

      await rotulo(contexto.page, 'El margen es (Precio − Costo) / Precio y NO descuenta la comisión del canal')
      await paso(contexto.page, 'El margen es 40 % y el texto aclara que no incluye la comisión', async () => {
        await expect(contexto.page.getByText('Margen estimado (escala x1):')).toContainText('40 %')
        await expect(contexto.page.getByText(/no incluye la comisión del canal/)).toBeVisible()
      })

      await paso(contexto.page, 'La pestaña «Precios y moneda» de la empresa muestra el mismo dólar', async () => {
        await contexto.page.goto(`/empresas/edit/${empresa.id}/precios`)
        await expect(contexto.page.getByText(/Dólar vigente \$ 1\.465,1234/)).toBeVisible()
      })
    } finally {
      await cerrarContextoGrabado(contexto.contexto, contexto.page, testInfo)
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`usuario_empresa_activa?user_id=eq.${idUsuario}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`empresas?organizacion_id=eq.${orgId}`, 'dominio')
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      if (idUsuario) await borrarUsuario(idUsuario)
    }
  })
})
