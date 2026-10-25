import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// MSF-353 (F-STK-15, T019, FR-024): 10 traslados de 1 unidad en paralelo desde un depósito con
// disponible 5 → exactamente 5 aceptados y 5 rechazados con «No hay stock suficiente»; el origen
// queda en 0, el destino en 5, el total sigue en 5 y no se emite `stock.actualizado` por traslados.
// pgTAP corre en una sola conexión y no puede probar carreras: acá cada RPC entra por PostgREST
// en su propia conexión y todas serializan sobre el mismo producto.
// Requiere el stack local (`pnpm dev:supabase`); sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se
// omite (no entra al CI público): ver docs/e2e-app.md. La service-role key solo se usa en Node.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de traslados: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    headers: cabeceras({ 'accept-profile': esquema }),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'DELETE',
    headers: cabeceras({ 'content-profile': esquema }),
  })
  if (!r.ok) console.warn(`limpieza E2E: DELETE ${ruta} → ${r.status}`)
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

async function borrarUsuario(id: string) {
  const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: cabeceras() })
  if (!r.ok) console.warn(`limpieza E2E: baja de usuario ${id} → ${r.status}`)
}

async function tokenDe(correo: string): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`ingreso de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

async function rpc(token: string, nombre: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  return { ok: r.ok, texto: await r.text() }
}

test.describe('Stock · concurrencia de traslados (F-STK-15, FR-024)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('10 traslados simultáneos de 1 sobre disponible 5: 5 aceptados y el total no cambia', async () => {
    const sufijo = randomUUID().slice(0, 8)
    const correoA = `trasconc-a-${sufijo}@example.com`
    const correoB = `trasconc-b-${sufijo}@example.com`

    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E traslado concurrencia ${sufijo}` })
      orgId = org.id
      for (const correo of [correoA, correoB]) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', [{ user_id: id, organizacion_id: org.id, rol_id: 'administrador' }])
      }
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre: `Producto traslado ${sufijo}`, sku: `TRASCONC-${sufijo}`, precio_lista: 10 },
        'dominio',
      )
      // La organización nace con «Depósito principal» (por defecto); se suma el destino.
      const [destino] = await rest<{ id: string }>(
        'depositos',
        { organizacion_id: org.id, nombre: `Depósito destino ${sufijo}` },
        'dominio',
      )
      const depositos = await leer<{ id: string; por_defecto: boolean }>(
        `depositos?organizacion_id=eq.${org.id}&select=id,por_defecto`,
        'dominio',
      )
      const origen = depositos.find((d) => d.por_defecto)
      expect(origen, 'la organización tiene un depósito por defecto').toBeTruthy()

      const motivos = await leer<{ id: string; nombre: string }>(
        `motivos_movimiento?organizacion_id=eq.${org.id}&select=id,nombre`,
        'dominio',
      )
      const motivoEntrada = motivos.find((m) => m.nombre === 'Compra a proveedor')?.id
      expect(motivoEntrada, 'motivo de entrada sembrado').toBeTruthy()

      const tokenA = await tokenDe(correoA)
      const tokenB = await tokenDe(correoB)

      const entrada = await rpc(tokenA, 'registrar_movimiento_stock', {
        p_producto: producto.id, p_deposito: origen?.id, p_tipo: 'entrada', p_cantidad: 5, p_motivo: motivoEntrada,
      })
      expect(entrada.ok, entrada.texto).toBe(true)

      // 10 traslados de 1 lanzados a la vez desde el mismo origen, repartidos entre dos sesiones.
      const traslados = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          rpc(i % 2 === 0 ? tokenA : tokenB, 'trasladar_stock', {
            p_producto: producto.id, p_origen: origen?.id, p_destino: destino.id, p_cantidad: 1,
          }),
        ),
      )
      const aceptados = traslados.filter((t) => t.ok)
      const rechazados = traslados.filter((t) => !t.ok)
      expect(aceptados).toHaveLength(5)
      expect(rechazados).toHaveLength(5)
      for (const rechazo of rechazados) expect(rechazo.texto).toContain('No hay stock suficiente')

      const porDeposito = await leer<{ deposito_id: string; cantidad: number; reservado: number }>(
        `existencias_deposito?producto_id=eq.${producto.id}&select=deposito_id,cantidad,reservado`,
        'dominio',
      )
      const cifras = Object.fromEntries(porDeposito.map((f) => [f.deposito_id, f.cantidad]))
      expect(cifras[origen?.id ?? '']).toBe(0)
      expect(cifras[destino.id]).toBe(5)

      const total = await leer<{ cantidad: number; reservado: number }>(
        `existencias?producto_id=eq.${producto.id}&select=cantidad,reservado`,
        'dominio',
      )
      expect(total).toEqual([{ cantidad: 5, reservado: 0 }])

      // Solo los traslados aceptados dejan movimientos: 5 salidas en el origen y 5 entradas en el destino,
      // vinculados de a pares por traslado_id.
      const movimientos = await leer<{ tipo: string; deposito_id: string; traslado_id: string }>(
        `movimientos_stock?producto_id=eq.${producto.id}&traslado_id=not.is.null&select=tipo,deposito_id,traslado_id`,
        'dominio',
      )
      expect(movimientos).toHaveLength(10)
      expect(movimientos.filter((m) => m.tipo === 'salida' && m.deposito_id === origen?.id)).toHaveLength(5)
      expect(movimientos.filter((m) => m.tipo === 'entrada' && m.deposito_id === destino.id)).toHaveLength(5)
      expect(new Set(movimientos.map((m) => m.traslado_id)).size).toBe(5)

      // D-5: el traslado no cambia el total, así que solo existe el evento de la entrada inicial.
      const eventos = await leer<{ carga: { tipo_movimiento: string } }>(
        `cola_eventos?organizacion_id=eq.${org.id}&tipo=eq.stock.actualizado&select=carga`,
      )
      expect(eventos).toHaveLength(1)
      expect(eventos[0].carga.tipo_movimiento).toBe('entrada')
    } finally {
      if (orgId) {
        await borrar(`cola_eventos?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
