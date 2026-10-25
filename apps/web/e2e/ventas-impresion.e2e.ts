import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Cierre de MSF-213 (SC-009, T035): factura confirmada → imprimir factura y remito → marca y reimpresión →
// presupuesto → PDF → correo. Mide y registra la latencia de generación del PDF.
// Requiere el stack local (`pnpm dev:supabase`) y el worker compilado (`pnpm --filter @workers/comprobantes-pdf build`).
// El E2E hace de flow de Kestra para el PDF: reclama el pedido pendiente y corre el worker real (`node dist/index.js`)
// con la conexión Postgres local (E2E_PG*, por defecto el Postgres de `dev:supabase`). Siembra con la API admin desde
// Node (la service-role key nunca llega al navegador). El tramo del correo llega hasta el envío pendiente y su orden
// en la outbox; con `E2E_CORREO_KESTRA=1` (Kestra + SMTP de prueba/Mailpit levantados) también espera el mensaje con
// el PDF adjunto. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público):
// ver docs/e2e-app.md y docs/ventas-impresion.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mailpit = process.env.MAILPIT_URL ?? `http://127.0.0.1:${process.env.SUPABASE_MAILPIT_PORT ?? '4302'}`
const conCorreoKestra = process.env.E2E_CORREO_KESTRA === '1'
const password = 'Correcta-12345!'
const LIMITE_GENERACION_MS = 90_000 // tope de espera de la pantalla (docs/ventas-impresion.md)

// La service-role key escribe datos y crea usuarios con contraseña conocida: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de ventas-impresion: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function leer<T>(ruta: string, esquema = 'dominio'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
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

type Documento = { id: string; tipo_documento: string; estado: string; ejecucion_id: string | null }

// Corre el worker real con la conexión Postgres local; devuelve la duración de la generación.
function correrWorker(documentoId: string, ejecucionId: string): Promise<number> {
  const entrada = resolve(process.cwd(), '../../workers/comprobantes-pdf/dist/index.js')
  const inicio = Date.now()
  return new Promise((ok, falla) => {
    const hijo = spawn(process.execPath, [entrada], {
      env: {
        ...process.env,
        DOCUMENTO_ID: documentoId,
        EJECUCION_ID: ejecucionId,
        SUPABASE_URL: url,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
        PGHOST: process.env.E2E_PGHOST ?? '127.0.0.1',
        PGPORT: process.env.E2E_PGPORT ?? '54322',
        PGDATABASE: process.env.E2E_PGDATABASE ?? 'postgres',
        PGUSER: process.env.E2E_PGUSER ?? 'postgres',
        PGPASSWORD: process.env.E2E_PGPASSWORD ?? 'postgres',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    hijo.stderr.on('data', (trozo) => (stderr += String(trozo)))
    hijo.on('error', falla)
    hijo.on('close', (codigo) => (codigo === 0 ? ok(Date.now() - inicio) : falla(new Error(`worker salió con ${codigo}: ${stderr}`))))
  })
}

// Hace de flow `comprobantes-documentos`: atiende cada pedido `pendiente` de la organización con el worker real.
function atenderPedidos(organizacionId: string) {
  let activo = true
  const duraciones: Record<string, number[]> = {}
  const atendidos = new Set<string>()
  let fallo: unknown = null
  const ciclo = (async () => {
    try {
      while (activo) {
        const pendientes = await leer<Documento>(
          `comprobante_documentos?organizacion_id=eq.${organizacionId}&estado=eq.pendiente&select=id,tipo_documento,estado,ejecucion_id`,
        )
        for (const doc of pendientes) {
          if (atendidos.has(doc.id) || !doc.ejecucion_id) continue
          atendidos.add(doc.id)
          const ms = await correrWorker(doc.id, doc.ejecucion_id)
          ;(duraciones[doc.tipo_documento] ??= []).push(ms)
        }
        await new Promise((resolver) => setTimeout(resolver, 500))
      }
    } catch (error) {
      fallo = error
    }
  })()
  return {
    duraciones,
    async detener() {
      activo = false
      await ciclo
      if (fallo) throw fallo
    },
  }
}

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await page.getByLabel('Correo').fill(correo)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Confirma el diálogo «Imprimir comprobante» con el documento elegido y espera el PDF abierto y el aviso.
async function imprimir(page: Page, documento: RegExp, aviso: string | RegExp): Promise<number> {
  const dialogo = page.getByRole('dialog', { name: 'Imprimir comprobante' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByRole('radio', { name: documento }).check()
  const avisosPrevios = await page.getByText(aviso).count()
  const inicio = Date.now()
  const popup = page.waitForEvent('popup', { timeout: LIMITE_GENERACION_MS })
  await dialogo.getByRole('button', { name: 'Imprimir', exact: true }).click()
  const ventana = await popup
  const latencia = Date.now() - inicio
  expect(ventana.url()).toContain('/storage/v1/object/sign/comprobantes-documentos/')
  await ventana.close()
  await expect.poll(() => page.getByText(aviso).count()).toBeGreaterThan(avisosPrevios)
  return latencia
}

test.describe('Ventas · impresión de punta a punta (MSF-213, SC-009)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('factura y remito con marca y reimpresión; presupuesto en PDF y por correo', async ({ page }) => {
    test.setTimeout(240_000)
    const sufijo = randomUUID().slice(0, 8)
    const correoAdmin = `admin-imp-${sufijo}@example.com`
    const correoCliente = `cliente-imp-${sufijo}@example.com`
    const nombreCliente = `Cliente Impresión ${sufijo}`
    let organizacionId: string | null = null
    let usuarioId: string | null = null
    const worker = { detener: async () => {}, duraciones: {} as Record<string, number[]> }
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E impresión ${sufijo}` })
      organizacionId = org.id
      const [empresa] = await rest<{ id: string }>(
        'empresas',
        { organizacion_id: org.id, nombre: `Tienda Impresión ${sufijo}`, razon_social: `Tienda ${sufijo} SRL`, cuit: '30712345678' },
        'dominio',
      )
      usuarioId = await altaUsuario(correoAdmin)
      await rest('usuarios_organizacion', { user_id: usuarioId, organizacion_id: org.id, rol_id: 'administrador' })
      // Conexión del generador de PDF de la organización (docs/ventas-impresion.md, «Puesta en marcha»).
      await rest('conexiones', { organizacion_id: org.id, sistema_externo: 'comprobantes-pdf', credencial_vault_id: randomUUID() })
      const [cliente] = await rest<{ id: string }>('clientes', {
        organizacion_id: org.id,
        numero: 1,
        nombre: nombreCliente,
        tipo: 'minorista',
        correo: correoCliente,
      })
      const base = {
        organizacion_id: org.id,
        cliente_id: cliente.id,
        empresa_id: empresa.id,
        fecha: new Date().toISOString().slice(0, 10),
        total_sin_iva: 100,
        total_con_iva: 121,
        canal: 'mostrador',
        operador_id: usuarioId,
      }
      const [factura, presupuesto] = await rest<{ id: string }>(
        'comprobantes_venta',
        [
          { ...base, tipo: 'factura', numero: '00000001', estado: 'confirmada' },
          { ...base, tipo: 'presupuesto', numero: '00000001', estado: 'pendiente' },
        ],
        'dominio',
      )

      const atencion = atenderPedidos(org.id)
      worker.detener = atencion.detener
      worker.duraciones = atencion.duraciones

      await ingresar(page, correoAdmin)

      // Factura y remito: cada uno genera su PDF, abre una URL firmada y deja su marca.
      await page.goto(`/ventas/comprobantes/${factura.id}`)
      await page.getByRole('button', { name: 'Imprimir', exact: true }).first().click()
      const latenciaFactura = await imprimir(page, /^Factura/, 'Enviado a imprimir')
      await page.getByRole('button', { name: 'Imprimir remito' }).click()
      const latenciaRemito = await imprimir(page, /^Remito/, 'Enviado a imprimir')
      await expect(page.getByText(/Factura impresa · \d{2}\/\d{2} \d{2}:\d{2}/)).toBeVisible()
      await expect(page.getByText(/Remito impreso · \d{2}\/\d{2} \d{2}:\d{2}/)).toBeVisible()

      // Reimpresión: sin límite, reutiliza el PDF vigente y no crea otro pedido; queda registrada como reimpresión.
      await page.getByRole('button', { name: 'Imprimir remito' }).click()
      await imprimir(page, /^Remito/, 'Enviado a imprimir')
      const documentos = await leer<Documento>(`comprobante_documentos?comprobante_id=eq.${factura.id}&select=id,tipo_documento,estado,ejecucion_id`)
      expect(documentos.filter((d) => d.tipo_documento === 'remito')).toHaveLength(1)
      expect(documentos.every((d) => d.estado === 'generado')).toBe(true)
      const impresiones = await leer<{ tipo_documento: string; reimpresion: boolean }>(
        `comprobante_impresiones?comprobante_id=eq.${factura.id}&select=tipo_documento,reimpresion`,
      )
      expect(impresiones.filter((i) => i.tipo_documento === 'remito').map((i) => i.reimpresion).sort()).toEqual([false, true])
      expect(impresiones.filter((i) => i.tipo_documento === 'factura')).toHaveLength(1)

      // Presupuesto: PDF y pedido de correo al cliente.
      await page.goto(`/ventas/comprobantes/${presupuesto.id}`)
      await page.getByRole('button', { name: 'Imprimir', exact: true }).first().click()
      const latenciaPresupuesto = await imprimir(page, /^Presupuesto/, 'Enviado a imprimir')
      await expect(page.getByText(/Presupuesto impreso · \d{2}\/\d{2} \d{2}:\d{2}/)).toBeVisible()

      await page.getByRole('button', { name: 'Enviar por correo' }).click()
      await expect
        .poll(async () => (await leer<{ estado: string; destinatario: string }>(`comprobante_envios_correo?comprobante_id=eq.${presupuesto.id}&select=estado,destinatario`))[0], {
          timeout: 15_000,
        })
        .toMatchObject({ destinatario: correoCliente, estado: expect.stringMatching(/^(pendiente|enviado)$/) })
      const ordenes = await leer<{ clave: string }>(`capacidades_ejecucion?organizacion_id=eq.${org.id}&clave=like.enviar-presupuesto-correo-*&select=clave`, 'public')
      expect(ordenes.length).toBeGreaterThan(0)

      if (conCorreoKestra) {
        // Con Kestra y el SMTP de prueba levantados, el flow `comprobantes-correo` entrega el correo con el PDF adjunto.
        await expect(page.getByText(/Presupuesto enviado por correo · \d{2}\/\d{2} \d{2}:\d{2}/)).toBeVisible({ timeout: 120_000 })
        const lista = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${correoCliente}`)}`)).json()
        expect((lista as { messages: Array<{ Attachments: number }> }).messages[0]?.Attachments).toBeGreaterThan(0)
      }

      // SC-009: la latencia de generación (pedido → PDF abierto) queda registrada en el informe del test.
      const resumen = { factura_ms: latenciaFactura, remito_ms: latenciaRemito, presupuesto_ms: latenciaPresupuesto, worker_ms: worker.duraciones }
      test.info().annotations.push({ type: 'latencia-generacion', description: JSON.stringify(resumen) })
      console.log(`Latencia de generación de PDF (SC-009): ${JSON.stringify(resumen)}`)
      for (const ms of [latenciaFactura, latenciaRemito, latenciaPresupuesto]) expect(ms).toBeLessThan(LIMITE_GENERACION_MS)
    } finally {
      try {
        await worker.detener()
      } finally {
        try {
          if (organizacionId) await borrar(`organizaciones?id=eq.${organizacionId}`)
        } finally {
          if (usuarioId) await borrarUsuario(usuarioId)
        }
      }
    }
  })
})
