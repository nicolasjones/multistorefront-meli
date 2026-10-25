import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// MSF-249 (F-STK-04, T007, FR-001, FR-002, SC-001): 20 salidas de 1 unidad en paralelo sobre un
// producto con stock 10 → exactamente 10 aceptadas, 10 rechazadas con «No hay stock suficiente»,
// stock 0, 10 movimientos de salida y 10 eventos `stock.actualizado` de salida (más el de la
// entrada inicial). pgTAP corre en una sola conexión y no puede probar carreras: acá cada RPC
// entra por PostgREST en su propia conexión. Dos usuarios de la misma organización leen la
// misma cantidad (stock único por organización; la empresa activa no segmenta existencias).
// Requiere el stack local (`pnpm dev:supabase`); sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se
// omite (no entra al CI público): ver docs/e2e-app.md. La service-role key solo se usa en Node.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = 'Correcta-12345!'

// La service-role key crea y borra datos: solo contra un Supabase local.
const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de stock: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
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

async function rpcStock(token: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/registrar_movimiento_stock`, {
    method: 'POST',
    headers: { apikey: serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  return { ok: r.ok, texto: await r.text() }
}

test.describe('Stock · concurrencia real (F-STK-04, SC-001)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('20 salidas simultáneas sobre stock 10: 10 aceptadas, 10 rechazadas, stock 0 y 10 eventos', async () => {
    const sufijo = randomUUID().slice(0, 8)
    const correoA = `conc-a-${sufijo}@example.com`
    const correoB = `conc-b-${sufijo}@example.com`

    let orgId: string | undefined
    const usuarios: string[] = []
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E concurrencia ${sufijo}` })
      orgId = org.id
      for (const correo of [correoA, correoB]) {
        const id = await altaUsuario(correo)
        usuarios.push(id)
        await rest('usuarios_organizacion', [{ user_id: id, organizacion_id: org.id, rol_id: 'administrador' }])
      }
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre: `Producto concurrencia ${sufijo}`, sku: `CONC-${sufijo}`, precio_lista: 10 },
        'dominio',
      )
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
        p_producto: producto.id, p_tipo: 'entrada', p_cantidad: 10, p_motivo: motivoEntrada,
      })
      expect(entrada.ok, entrada.texto).toBe(true)

      // 20 salidas de 1 unidad lanzadas a la vez, repartidas entre las dos sesiones.
      const salidas = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          rpcStock(i % 2 === 0 ? tokenA : tokenB, {
            p_producto: producto.id, p_tipo: 'salida', p_cantidad: 1, p_motivo: motivoSalida,
          }),
        ),
      )
      const aceptadas = salidas.filter((s) => s.ok)
      const rechazadas = salidas.filter((s) => !s.ok)
      expect(aceptadas).toHaveLength(10)
      expect(rechazadas).toHaveLength(10)
      for (const rechazo of rechazadas) expect(rechazo.texto).toContain('No hay stock suficiente')

      // Las dos sesiones leen la misma cantidad: 0.
      for (const token of [tokenA, tokenB]) {
        const r = await fetch(`${url}/rest/v1/existencias?producto_id=eq.${producto.id}&select=cantidad`, {
          headers: { apikey: serviceKey ?? '', authorization: `Bearer ${token}`, 'accept-profile': 'dominio' },
        })
        expect(r.ok).toBe(true)
        expect(await r.json()).toEqual([{ cantidad: 0 }])
      }

      const salidasRegistradas = await leer<{ id: string }>(
        `movimientos_stock?producto_id=eq.${producto.id}&tipo=eq.salida&select=id`,
        'dominio',
      )
      expect(salidasRegistradas).toHaveLength(10)

      // Un evento por movimiento aceptado: 10 salidas + la entrada inicial.
      const eventos = await leer<{ carga: { tipo_movimiento: string; cantidad: number } }>(
        `cola_eventos?organizacion_id=eq.${org.id}&tipo=eq.stock.actualizado&select=carga`,
      )
      expect(eventos).toHaveLength(11)
      expect(eventos.filter((e) => e.carga.tipo_movimiento === 'salida')).toHaveLength(10)
      expect(eventos.map((e) => e.carga.cantidad).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
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
