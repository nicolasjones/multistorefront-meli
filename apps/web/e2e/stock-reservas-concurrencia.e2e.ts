import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// MSF-337 (F-STK-16, T030, FR-032, US3-6): 8 reservas de 1 unidad en paralelo sobre un producto
// «A pedido» con disponible 5 → exactamente 5 aceptadas y 3 rechazadas con «No hay stock
// suficiente», reservado 5, disponible 0, 5 reservas activas y 5 eventos `reserva`. pgTAP corre en
// una sola conexión y no puede probar carreras: acá cada RPC entra por PostgREST en su propia
// conexión. Requiere el stack local (`pnpm dev:supabase`); sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY se omite (no entra al CI público): ver docs/e2e-app.md. La
// service-role key solo se usa en Node, nunca en el navegador.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de reservas: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

// JWT de la persona: la RPC corre con su sesión (organización y rol salen del token).
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

test.describe('Stock · concurrencia de reservas (F-STK-16, FR-032)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('8 reservas simultáneas de 1 sobre disponible 5: 5 aceptadas, 3 rechazadas y disponible 0', async () => {
    const sufijo = randomUUID().slice(0, 8)
    const correoA = `resconc-a-${sufijo}@example.com`
    const correoB = `resconc-b-${sufijo}@example.com`

    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E reservas ${sufijo}` })
      orgId = org.id
      for (const correo of [correoA, correoB]) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', [{ user_id: id, organizacion_id: org.id, rol_id: 'administrador' }])
      }
      const [producto] = await rest<{ id: string }>(
        'productos',
        {
          organizacion_id: org.id,
          nombre: `Producto a pedido ${sufijo}`,
          sku: `RESCONC-${sufijo}`,
          precio_lista: 10,
          disponibilidad_manual: 'a_pedido',
        },
        'dominio',
      )
      // La organización nace con «Depósito principal» (por defecto) por la migración de F-STK-14.
      const depositos = await leer<{ id: string; por_defecto: boolean }>(
        `depositos?organizacion_id=eq.${org.id}&select=id,por_defecto`,
        'dominio',
      )
      const deposito = depositos.find((d) => d.por_defecto)
      expect(deposito, 'la organización tiene un depósito por defecto').toBeTruthy()

      const motivos = await leer<{ id: string; nombre: string }>(
        `motivos_movimiento?organizacion_id=eq.${org.id}&select=id,nombre`,
        'dominio',
      )
      const motivoEntrada = motivos.find((m) => m.nombre === 'Compra a proveedor')?.id
      expect(motivoEntrada, 'motivo de entrada sembrado').toBeTruthy()

      const tokenA = await tokenDe(correoA)
      const tokenB = await tokenDe(correoB)

      const entrada = await rpc(tokenA, 'registrar_movimiento_stock', {
        p_producto: producto.id, p_deposito: deposito?.id, p_tipo: 'entrada', p_cantidad: 5, p_motivo: motivoEntrada,
      })
      expect(entrada.ok, entrada.texto).toBe(true)

      // 8 reservas de 1 lanzadas a la vez, repartidas entre las dos sesiones, cada una con su referencia.
      const reservas = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          rpc(i % 2 === 0 ? tokenA : tokenB, 'reservar_stock', {
            p_producto: producto.id, p_deposito: deposito?.id, p_cantidad: 1, p_referencia: `LINEA-${sufijo}-${i}`,
          }),
        ),
      )
      const aceptadas = reservas.filter((r) => r.ok)
      const rechazadas = reservas.filter((r) => !r.ok)
      expect(aceptadas).toHaveLength(5)
      expect(rechazadas).toHaveLength(3)
      for (const rechazo of rechazadas) expect(rechazo.texto).toContain('No hay stock suficiente')

      const [existencia] = await leer<{ cantidad: number; reservado: number }>(
        `existencias?producto_id=eq.${producto.id}&select=cantidad,reservado`,
        'dominio',
      )
      expect(existencia).toEqual({ cantidad: 5, reservado: 5 })

      const [porDeposito] = await leer<{ cantidad: number; reservado: number }>(
        `existencias_deposito?producto_id=eq.${producto.id}&deposito_id=eq.${deposito?.id}&select=cantidad,reservado`,
        'dominio',
      )
      expect(porDeposito).toEqual({ cantidad: 5, reservado: 5 })

      const activas = await leer<{ id: string }>(
        `reservas_stock?producto_id=eq.${producto.id}&estado=eq.activa&select=id`,
        'dominio',
      )
      expect(activas).toHaveLength(5)

      // Un evento por reserva aceptada; los rechazos no dejan rastro.
      const eventos = await leer<{ carga: { tipo_movimiento: string; disponible: number } }>(
        `cola_eventos?organizacion_id=eq.${org.id}&tipo=eq.stock.actualizado&select=carga`,
      )
      const deReserva = eventos.filter((e) => e.carga.tipo_movimiento === 'reserva')
      expect(deReserva).toHaveLength(5)
      expect(deReserva.map((e) => e.carga.disponible).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
    } finally {
      // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
      if (orgId) {
        await borrar(`cola_eventos?organizacion_id=eq.${orgId}`)
        await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
        await borrar(`organizaciones?id=eq.${orgId}`)
      }
      for (const id of usuarios) await borrarUsuario(id)
    }
  })
})
