import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// MSF-316 (F-STK-14, T009, FR-009, SC-002): 20 salidas de 1 unidad en paralelo sobre un depósito
// con disponible 10 → exactamente 10 aceptadas, 10 rechazadas con «No hay stock suficiente»,
// cantidad y disponible del depósito en 0 y 10 movimientos de salida con su depósito.
// pgTAP corre en una sola conexión y no puede probar carreras: acá cada RPC entra por PostgREST
// en su propia conexión. La barrera es el disponible DEL DEPÓSITO (cantidad − reservado), no el
// total de la organización: las dos sesiones leen las mismas cifras porque el stock es único.
// Requiere el stack local (`pnpm dev:supabase`); sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se
// omite (no entra al CI público): ver docs/e2e-app.md. La service-role key solo se usa en Node.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de depósitos: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function rpcStock(token: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/registrar_movimiento_stock`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  return { ok: r.ok, texto: await r.text() }
}

test.describe('Stock · concurrencia por depósito (F-STK-14, SC-002)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('20 salidas simultáneas sobre disponible 10 en un depósito: 10 aceptadas y disponible 0', async () => {
    const sufijo = randomUUID().slice(0, 8)
    const correoA = `depconc-a-${sufijo}@example.com`
    const correoB = `depconc-b-${sufijo}@example.com`

    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E depósito concurrencia ${sufijo}` })
      orgId = org.id
      for (const correo of [correoA, correoB]) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', [{ user_id: id, organizacion_id: org.id, rol_id: 'administrador' }])
      }
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre: `Producto depósito ${sufijo}`, sku: `DEPCONC-${sufijo}`, precio_lista: 10 },
        'dominio',
      )
      // La organización nace con «Depósito principal» (por defecto) por la migración de F-STK-14.
      const depositos = await leer<{ id: string; nombre: string; por_defecto: boolean }>(
        `depositos?organizacion_id=eq.${org.id}&select=id,nombre,por_defecto`,
        'dominio',
      )
      const deposito = depositos.find((d) => d.por_defecto)
      expect(deposito, 'la organización tiene un depósito por defecto').toBeTruthy()

      const motivos = await leer<{ id: string; nombre: string }>(
        `motivos_movimiento?organizacion_id=eq.${org.id}&select=id,nombre`,
        'dominio',
      )
      const motivoEntrada = motivos.find((m) => m.nombre === 'Compra a proveedor')?.id
      const motivoSalida = motivos.find((m) => m.nombre === 'Venta en local')?.id
      expect(motivoEntrada, 'motivo de entrada sembrado').toBeTruthy()
      expect(motivoSalida, 'motivo de salida sembrado').toBeTruthy()

      const tokenA = await tokenDe(correoA)
      const tokenB = await tokenDe(correoB)

      const entrada = await rpcStock(tokenA, {
        p_producto: producto.id, p_deposito: deposito?.id, p_tipo: 'entrada', p_cantidad: 10, p_motivo: motivoEntrada,
      })
      expect(entrada.ok, entrada.texto).toBe(true)

      // 20 salidas de 1 lanzadas a la vez contra el mismo depósito, repartidas entre dos sesiones.
      const salidas = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          rpcStock(i % 2 === 0 ? tokenA : tokenB, {
            p_producto: producto.id, p_deposito: deposito?.id, p_tipo: 'salida', p_cantidad: 1, p_motivo: motivoSalida,
          }),
        ),
      )
      const aceptadas = salidas.filter((s) => s.ok)
      const rechazadas = salidas.filter((s) => !s.ok)
      expect(aceptadas).toHaveLength(10)
      expect(rechazadas).toHaveLength(10)
      for (const rechazo of rechazadas) expect(rechazo.texto).toContain('No hay stock suficiente')

      const porDeposito = await leer<{ cantidad: number; reservado: number }>(
        `existencias_deposito?producto_id=eq.${producto.id}&deposito_id=eq.${deposito?.id}&select=cantidad,reservado`,
        'dominio',
      )
      expect(porDeposito).toEqual([{ cantidad: 0, reservado: 0 }])

      const total = await leer<{ cantidad: number; reservado: number }>(
        `existencias?producto_id=eq.${producto.id}&select=cantidad,reservado`,
        'dominio',
      )
      expect(total).toEqual([{ cantidad: 0, reservado: 0 }])

      const salidasRegistradas = await leer<{ deposito_id: string }>(
        `movimientos_stock?producto_id=eq.${producto.id}&tipo=eq.salida&select=deposito_id`,
        'dominio',
      )
      expect(salidasRegistradas).toHaveLength(10)
      for (const salida of salidasRegistradas) expect(salida.deposito_id).toBe(deposito?.id)

      const eventos = await leer<{ carga: { tipo_movimiento: string; deposito_id: string; disponible: number } }>(
        `cola_eventos?organizacion_id=eq.${org.id}&tipo=eq.stock.actualizado&select=carga`,
      )
      expect(eventos).toHaveLength(11)
      const eventosSalida = eventos.filter((e) => e.carga.tipo_movimiento === 'salida')
      expect(eventosSalida).toHaveLength(10)
      for (const evento of eventosSalida) expect(evento.carga.deposito_id).toBe(deposito?.id)
      expect(eventosSalida.map((e) => e.carga.disponible).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
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
