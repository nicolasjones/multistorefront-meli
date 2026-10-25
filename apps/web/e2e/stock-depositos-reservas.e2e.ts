import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// MSF-546 (cierre de la épica MSF-292, T032, SC-003, SC-008): recorrido completo — crear un 2.º
// depósito → entrada de 10 → trasladar 4 → reservar 3 a pedido → disponible 7 → descontar → cantidad
// 7 y reservado 0 — y concurrencia mixta (traslado + reserva + salida) sobre el mismo disponible.
// pgTAP corre en una sola conexión y no puede probar carreras: acá cada RPC entra por PostgREST en su
// propia conexión. Requiere el stack local (`pnpm dev:supabase`); sin SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY se omite (no entra al CI público): ver docs/e2e-app.md. La service-role
// key solo se usa en Node, nunca en el navegador.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de la épica de depósitos y reservas: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

type Fila = { cantidad: number; reservado: number }

async function preparar(sufijo: string) {
  const correo = `epica-${sufijo}@example.com`
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E épica depósitos ${sufijo}` })
  const userId = await altaUsuario(correo)
  await rest('usuarios_organizacion', [{ user_id: userId, organizacion_id: org.id, rol_id: 'administrador' }])
  const [producto] = await rest<{ id: string }>(
    'productos',
    {
      organizacion_id: org.id,
      nombre: `Producto épica ${sufijo}`,
      sku: `EPICA-${sufijo}`,
      precio_lista: 10,
      disponibilidad_manual: 'a_pedido',
    },
    'dominio',
  )
  // La organización nace con «Depósito principal» (por defecto); se suma el 2.º depósito.
  const [segundo] = await rest<{ id: string }>(
    'depositos',
    { organizacion_id: org.id, nombre: `Depósito Sur ${sufijo}` },
    'dominio',
  )
  const depositos = await leer<{ id: string; por_defecto: boolean }>(
    `depositos?organizacion_id=eq.${org.id}&select=id,por_defecto`,
    'dominio',
  )
  const principal = depositos.find((d) => d.por_defecto)
  expect(principal, 'la organización tiene un depósito por defecto').toBeTruthy()
  const motivos = await leer<{ id: string; nombre: string }>(
    `motivos_movimiento?organizacion_id=eq.${org.id}&select=id,nombre`,
    'dominio',
  )
  const compra = motivos.find((m) => m.nombre === 'Compra a proveedor')?.id
  const venta = motivos.find((m) => m.nombre === 'Venta en local')?.id
  expect(compra, 'motivo de entrada sembrado').toBeTruthy()
  expect(venta, 'motivo de salida sembrado').toBeTruthy()
  const token = await tokenDe(correo)
  return {
    orgId: org.id, userId, token, producto: producto.id, principal: principal?.id ?? '', segundo: segundo.id,
    compra, venta,
  }
}

async function limpiar(orgId: string | undefined, usuarios: string[]) {
  // Limpieza: el Supabase local no acumula organizaciones ni usuarios sembrados.
  if (orgId) {
    await borrar(`cola_eventos?organizacion_id=eq.${orgId}`)
    await borrar(`usuarios_organizacion?organizacion_id=eq.${orgId}`)
    await borrar(`organizaciones?id=eq.${orgId}`)
  }
  for (const id of usuarios) await borrarUsuario(id)
}

test.describe('Stock · épica depósitos y reservas (MSF-292, cierre)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('recorrido: 2.º depósito, entrada 10, traslado 4, reserva 3, disponible 7, descuento (SC-008)', async () => {
    const sufijo = randomUUID().slice(0, 8)
    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const c = await preparar(sufijo)
      orgId = c.orgId
      usuarios.push(c.userId)

      const entrada = await rpc(c.token, 'registrar_movimiento_stock', {
        p_producto: c.producto, p_deposito: c.principal, p_tipo: 'entrada', p_cantidad: 10, p_motivo: c.compra,
      })
      expect(entrada.ok, entrada.texto).toBe(true)

      const traslado = await rpc(c.token, 'trasladar_stock', {
        p_producto: c.producto, p_origen: c.principal, p_destino: c.segundo, p_cantidad: 4,
      })
      expect(traslado.ok, traslado.texto).toBe(true)

      const reserva = await rpc(c.token, 'reservar_stock', {
        p_producto: c.producto, p_deposito: c.principal, p_cantidad: 3, p_referencia: `PEDIDO-${sufijo}`,
      })
      expect(reserva.ok, reserva.texto).toBe(true)
      const reservaId = (JSON.parse(reserva.texto) as { id: string }).id

      const porDeposito = async () =>
        Object.fromEntries(
          (
            await leer<Fila & { deposito_id: string }>(
              `existencias_deposito?producto_id=eq.${c.producto}&select=deposito_id,cantidad,reservado`,
              'dominio',
            )
          ).map((f) => [f.deposito_id, { cantidad: f.cantidad, reservado: f.reservado }]),
        )
      const total = async () =>
        leer<Fila>(`existencias?producto_id=eq.${c.producto}&select=cantidad,reservado`, 'dominio')

      // Total 10, reservado 3 → disponible 7; el principal tiene 6 (3 reservados) y el 2.º, 4.
      expect(await total()).toEqual([{ cantidad: 10, reservado: 3 }])
      expect(await porDeposito()).toEqual({
        [c.principal]: { cantidad: 6, reservado: 3 },
        [c.segundo]: { cantidad: 4, reservado: 0 },
      })

      const descuento = await rpc(c.token, 'descontar_reserva', { p_reserva: reservaId })
      expect(descuento.ok, descuento.texto).toBe(true)

      // Cantidad 7 y reservado 0; la reserva queda «descontada» y la salida en el libro.
      expect(await total()).toEqual([{ cantidad: 7, reservado: 0 }])
      const [res] = await leer<{ estado: string }>(`reservas_stock?id=eq.${reservaId}&select=estado`, 'dominio')
      expect(res.estado).toBe('descontada')
      const salidas = await leer<{ deposito_id: string; diferencia: number }>(
        `movimientos_stock?producto_id=eq.${c.producto}&tipo=eq.salida&traslado_id=is.null&select=deposito_id,diferencia`,
        'dominio',
      )
      expect(salidas).toHaveLength(1)
      expect(salidas[0].deposito_id).toBe(c.principal)
      expect(Math.abs(salidas[0].diferencia)).toBe(3)
    } finally {
      await limpiar(orgId, usuarios)
    }
  })

  test('concurrencia mixta traslado + reserva + salida sobre disponible 6: nunca se pasa (SC-003)', async () => {
    const sufijo = randomUUID().slice(0, 8)
    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const c = await preparar(sufijo)
      orgId = c.orgId
      usuarios.push(c.userId)

      const entrada = await rpc(c.token, 'registrar_movimiento_stock', {
        p_producto: c.producto, p_deposito: c.principal, p_tipo: 'entrada', p_cantidad: 6, p_motivo: c.compra,
      })
      expect(entrada.ok, entrada.texto).toBe(true)

      // 18 pedidos de 1 a la vez sobre el mismo depósito con disponible 6: 6 traslados, 6 reservas y
      // 6 salidas compiten; solo 6 pueden entrar, sea cual sea el orden.
      const pedidos = await Promise.all(
        Array.from({ length: 18 }, (_, i) => {
          const clase = i % 3
          if (clase === 0) {
            return rpc(c.token, 'trasladar_stock', {
              p_producto: c.producto, p_origen: c.principal, p_destino: c.segundo, p_cantidad: 1,
            }).then((r) => ({ ...r, clase }))
          }
          if (clase === 1) {
            return rpc(c.token, 'reservar_stock', {
              p_producto: c.producto, p_deposito: c.principal, p_cantidad: 1, p_referencia: `MIX-${sufijo}-${i}`,
            }).then((r) => ({ ...r, clase }))
          }
          return rpc(c.token, 'registrar_movimiento_stock', {
            p_producto: c.producto, p_deposito: c.principal, p_tipo: 'salida', p_cantidad: 1, p_motivo: c.venta,
          }).then((r) => ({ ...r, clase }))
        }),
      )
      const aceptados = pedidos.filter((p) => p.ok)
      const rechazados = pedidos.filter((p) => !p.ok)
      expect(aceptados).toHaveLength(6)
      expect(rechazados).toHaveLength(12)
      for (const rechazo of rechazados) expect(rechazo.texto).toContain('No hay stock suficiente')

      const trasladados = aceptados.filter((p) => p.clase === 0).length
      const reservados = aceptados.filter((p) => p.clase === 1).length
      const vendidos = aceptados.filter((p) => p.clase === 2).length

      // El disponible del depósito de origen queda exactamente en 0, jamás negativo.
      const [origen] = await leer<Fila>(
        `existencias_deposito?producto_id=eq.${c.producto}&deposito_id=eq.${c.principal}&select=cantidad,reservado`,
        'dominio',
      )
      expect(origen.cantidad - origen.reservado).toBe(0)
      expect(origen.reservado).toBe(reservados)
      expect(origen.cantidad).toBe(6 - trasladados - vendidos)

      // El total solo baja por las salidas; los traslados y las reservas no lo cambian.
      const [total] = await leer<Fila>(
        `existencias?producto_id=eq.${c.producto}&select=cantidad,reservado`,
        'dominio',
      )
      expect(total).toEqual({ cantidad: 6 - vendidos, reservado: reservados })
      const activas = await leer<{ id: string }>(
        `reservas_stock?producto_id=eq.${c.producto}&estado=eq.activa&select=id`,
        'dominio',
      )
      expect(activas).toHaveLength(reservados)
    } finally {
      await limpiar(orgId, usuarios)
    }
  })
})
