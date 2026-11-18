import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { altaUsuario, asignarEmpresasComoAdministrador, borrar, borrarUsuario, claveAnonima, crearConsulta, rest, serviceKey, url } from './soporte/fixtures'
import { tokenDe } from './semillas'

// Cierre de MSF-122 (SC-004, SC-008): una consulta enviada desde la tienda aparece en la bandeja en menos de
// 5 s y la base emite el aviso al equipo; se abre su enlace, se asigna, anota y resuelve con tres roles
// (administrador edita, consulta solo lee, mostrador no accede) y una segunda organización no la ve.
// Requiere el stack local (`pnpm dev:supabase`). Siembra con la API admin desde Node
// (la service-role key nunca llega al navegador). Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se
// omite (no entra al CI público): ver docs/e2e-app.md y docs/consultas.md.

const password = 'Correcta-12345!'
const LIMITE_BANDEJA_MS = 5_000

type AvisoConsulta = { tipo_aviso: string; datos: Record<string, string> }

// `public.avisos_pendientes` no se lee por la API (ni `service_role` ni `authenticated`): cada persona ve sus avisos con la RPC
// de la campanita, `listar_notificaciones`, con su propia sesión (`tokenDe`, de `semillas.ts`). La RPC solo trae los de su
// organización y de las secciones a las que tiene acceso.

// Avisos de nueva consulta de una persona para el visitante dado (los emite la base al crear la consulta).
async function avisosSinEspera(correo: string, nombre: string): Promise<AvisoConsulta[]> {
  const r = await fetch(`${url}/rest/v1/rpc/listar_notificaciones`, {
    method: 'POST',
    headers: { apikey: claveAnonima(), authorization: `Bearer ${await tokenDe(correo)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_limite: 50 }),
  })
  if (!r.ok) throw new Error(`listar_notificaciones de ${correo}: ${r.status} ${await r.text()}`)
  const { items } = (await r.json()) as { items: { tipo_nombre: string; datos: Record<string, string> }[] }
  return items
    .filter((aviso) => aviso.tipo_nombre === 'Consulta nueva' && aviso.datos?.Nombre === nombre)
    .map((aviso) => ({ tipo_aviso: 'consulta_nueva', datos: aviso.datos }))
}

// Espera (hasta 20 s) a que el aviso de ese visitante llegue a la persona.
async function avisosDe(correo: string, nombre: string): Promise<AvisoConsulta[]> {
  const limite = Date.now() + 20_000
  while (Date.now() < limite) {
    const propios = await avisosSinEspera(correo, nombre)
    if (propios.length > 0) return propios
    await new Promise((resolver) => setTimeout(resolver, 500))
  }
  throw new Error(`No se emitió el aviso de la consulta de ${nombre} en 20 s`)
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

  test('envío público, bandeja en menos de 5 s, aviso a quien corresponde, atención por rol y aislamiento entre organizaciones', async ({ browser }) => {
    test.setTimeout(120_000) // dos sesiones, tres roles y la espera de la bandeja
    const sufijo = randomUUID().slice(0, 8)
    const host = `consultas-${sufijo}.localhost`
    const empresa = `Tienda Consultas ${sufijo}`
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
      const [{ id: empresaId }] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: empresa }, 'dominio')
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
        // Fuera del Administrador, cada persona ve solo las empresas que se le asignan (permisos por empresa). `service_role`
        // no escribe en `usuarios_empresas`: el Administrador de la organización, sembrado primero, las asigna con la RPC.
        if (rol !== 'administrador') await asignarEmpresasComoAdministrador(correos.admin, id, [{ empresa_id: empresaId, rol_id: rol }])
      }

      // SC-004: desde que la tienda envía hasta que la bandeja la muestra pasan menos de 5 s.
      const contextoAdmin = await browser.newContext()
      const admin = await contextoAdmin.newPage()
      await ingresar(admin, correos.admin)
      await admin.goto('/consultas')
      const inicio = Date.now()
      const consultaId = await crearConsulta(host, { nombre: visitante, contacto: 'visitante@example.com' })
      await admin.reload()
      const fila = admin.getByRole('row', { name: new RegExp(visitante) })
      await expect(fila).toBeVisible({ timeout: LIMITE_BANDEJA_MS })
      expect(Date.now() - inicio).toBeLessThan(LIMITE_BANDEJA_MS)

      // SC-008: al entrar la consulta la base emite el aviso (`emitir_aviso`, migración 20261210130300) solo a quien tiene
      // acceso a Consultas en esa empresa, con los datos de la consulta; el correo SMTP de `enviar-aviso-consulta`
      // ya no existe (MSF-853).
      const [avisoAdmin] = await avisosDe(correos.admin, visitante)
      expect(avisoAdmin.datos).toMatchObject({
        Empresa: empresa,
        Origen: 'Formulario de contacto',
        Nombre: visitante,
        Contacto: 'visitante@example.com',
        Mensaje: 'Hola, ¿tienen stock?',
      })
      const [avisoLectura] = await avisosDe(correos.lectura, visitante) // el rol Consulta también ve la sección
      expect(avisoLectura.datos.Nombre).toBe(visitante)
      // No lo reciben ni Mostrador (sin acceso a Consultas) ni la persona de OTRA organización.
      expect(await avisosSinEspera(correos.sinAcceso, visitante)).toHaveLength(0)
      expect(await avisosSinEspera(correos.ajena, visitante)).toHaveLength(0)
      // El detalle se abre desde el panel por la ruta `/consultas?consulta=<id>`: el aviso no lleva
      // enlace (es una fila de `public.avisos_pendientes`).
      await admin.goto(`/consultas?consulta=${consultaId}`)
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

      // Rol Mostrador (Ninguno): «No tenés acceso a esta sección» y sin Consultas en el menú.
      const contextoSin = await browser.newContext()
      const sin = await contextoSin.newPage()
      await ingresar(sin, correos.sinAcceso)
      await sin.goto('/consultas')
      await expect(sin.getByText('No tenés acceso a esta sección')).toBeVisible()
      await expect(sin.getByText(visitante)).toHaveCount(0)
      await contextoSin.close()

      // Otra organización: ni la bandeja ni la ruta del detalle revelan la consulta.
      const contextoAjena = await browser.newContext()
      const ajena = await contextoAjena.newPage()
      await ingresar(ajena, correos.ajena)
      await ajena.goto(`/consultas?consulta=${consultaId}`)
      await expect(ajena.getByText(visitante)).toHaveCount(0)
      await expect(ajena.getByRole('dialog', { name: `Consulta de ${visitante}` })).toHaveCount(0)
      await contextoAjena.close()
    } finally {
      // Borrar la organización arrastra por `on delete cascade` dominio.empresas, dominio.tiendas,
      // dominio.consultas y dominio.consultas_configuracion (ver las migraciones 20261013120000,
      // 20261023100000 y 20261205200000).
      for (const org of orgs) await borrar(`organizaciones?id=eq.${org}`)
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
