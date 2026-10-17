import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-121 (T022, SC-002): asignar empresas y rol desde Usuarios,
// cambiar de empresa activa y comprobar que el nivel de edición resuelto
// cambia con ella. Requiere el stack local (`pnpm dev:supabase`) y la web
// servida; siembra con la API admin desde Node (la service-role key nunca llega
// al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite (no entra al CI público): ver docs/e2e-app.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({
      prefer: 'return=representation',
      'content-profile': esquema,
    }),
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

async function borrar(ruta: string, esquema = 'public') {
  await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'DELETE',
    headers: cabeceras({ 'content-profile': esquema }),
  })
}

async function borrarUsuario(id: string) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: cabeceras(),
  })
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Nivel de «ventas» (sección por empresa) tal como lo recibe el panel: es lo
// que decide si los botones de edición se muestran (`nivelPermiteAccionRefine`).
// Se arma junto a la acción que dispara la recarga (`Promise.all`) para no
// tomar una respuesta residual anterior.
async function nivelVentasTras(page: Page, accion: () => Promise<unknown>): Promise<string | undefined> {
  const [respuesta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/rpc/permisos_actuales') && r.ok()),
    accion(),
  ])
  const permisos = (await respuesta.json()) as Array<{
    seccion: string
    nivel: string
  }>
  return permisos.find((p) => p.seccion === 'ventas')?.nivel
}

test.describe('Permisos por empresa (F-ROL-04/06/07)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('asignar empresas, cambiar de empresa y ver el nivel de edición de cada una', async ({ browser }) => {
    const sufijo = randomUUID().slice(0, 8)
    const correoAdmin = `admin-emp-${sufijo}@example.com`
    const correoPersona = `persona-emp-${sufijo}@example.com`
    const empresaA = `Empresa A ${sufijo}`
    const empresaB = `Empresa B ${sufijo}`

    const [org] = await rest<{ id: string }>('organizaciones', {
      nombre: `E2E empresas ${sufijo}`,
    })
    const [idA, idB] = (
      await rest<{ id: string }>(
        'empresas',
        [
          { organizacion_id: org.id, nombre: empresaA },
          { organizacion_id: org.id, nombre: empresaB },
        ],
        'dominio',
      )
    ).map((e) => e.id)
    const ids: string[] = []
    try {
      const idAdmin = await altaUsuario(correoAdmin)
      ids.push(idAdmin)
      const idPersona = await altaUsuario(correoPersona)
      ids.push(idPersona)
      await rest('usuarios_organizacion', [
        { user_id: idAdmin, organizacion_id: org.id, rol_id: 'administrador' },
        { user_id: idPersona, organizacion_id: org.id, rol_id: 'consulta' },
      ])

      // 1) El Administrador asigna: Operador en A, Consulta en B (Editar usuario).
      const contextoAdmin = await browser.newContext()
      const admin = await contextoAdmin.newPage()
      await ingresar(admin, correoAdmin)
      await admin.goto('/usuarios')
      await admin
        .getByRole('row', { name: new RegExp(correoPersona) })
        .getByRole('button', { name: 'Editar' })
        .click()
      const dialogo = admin.getByRole('dialog', { name: 'Editar usuario' })
      await dialogo.getByRole('checkbox', { name: empresaA }).check()
      await dialogo.getByLabel(`Rol en ${empresaA}`).click()
      await admin.getByRole('option', { name: 'Operador' }).click()
      await dialogo.getByRole('checkbox', { name: empresaB }).check()
      await dialogo.getByLabel(`Rol en ${empresaB}`).click()
      await admin.getByRole('option', { name: 'Consulta' }).click()
      await dialogo.getByRole('button', { name: 'Guardar' }).click()
      await expect(dialogo).toBeHidden()
      await contextoAdmin.close()

      // 2) La persona entra con la primera empresa como activa y cambia a la otra.
      const contexto = await browser.newContext()
      const persona = await contexto.newPage()
      await ingresar(persona, correoPersona)
      const activa = persona.getByRole('button', { name: /^Empresa activa:/ })
      await expect(activa).toBeVisible()
      // La empresa activa ya está resuelta: se recargan los permisos desde ese estado.
      const primerNivel = nivelVentasTras(persona, () => persona.reload())
      await expect(activa).toBeVisible()
      const enA = (await activa.getAttribute('aria-label'))?.includes(empresaA) ?? false
      const nombreDestino = enA ? empresaB : empresaA
      // Operador edita ventas; Consulta solo lee.
      expect(await primerNivel).toBe(enA ? 'edicion' : 'lectura')

      await activa.click()
      const segundoNivel = nivelVentasTras(persona, () =>
        persona.getByRole('menuitem', { name: new RegExp(nombreDestino) }).click(),
      )
      await expect(
        persona.getByRole('button', {
          name: `Empresa activa: ${nombreDestino}`,
        }),
      ).toBeVisible()
      expect(await segundoNivel).toBe(enA ? 'lectura' : 'edicion')

      // 3) El cambio persiste en la base (usuario_empresa_activa).
      const filas = await fetch(`${url}/rest/v1/usuario_empresa_activa?user_id=eq.${idPersona}&select=empresa_id`, {
        headers: cabeceras(),
      })
      const [fila] = (await filas.json()) as Array<{ empresa_id: string }>
      expect(fila.empresa_id).toBe(enA ? idB : idA)
      await contexto.close()
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      await borrar(`usuarios_organizacion?organizacion_id=eq.${org.id}`)
      await borrar(`empresas?organizacion_id=eq.${org.id}`, 'dominio')
      await borrar(`organizaciones?id=eq.${org.id}`)
      for (const id of ids) await borrarUsuario(id)
    }
  })
})
