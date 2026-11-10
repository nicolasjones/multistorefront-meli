import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// Cierre de MSF-217 (T033, FR-090, SC-009): agregar, quitar y anular reparaciones con stock por depósito.
// Las RPC entran por PostgREST con la sesión de la persona (como la app); la service-role key solo
// siembra y lee desde Node, nunca llega al navegador. Requiere el stack local (`pnpm dev:supabase`);
// sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omite (no entra al CI público): ver docs/e2e-app.md
// y docs/service-repuestos-stock.md.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
const password = 'Correcta-12345!'

const HOSTS_LOCALES = ['localhost', '127.0.0.1', 'host.docker.internal']
if (url && !HOSTS_LOCALES.includes(new URL(url).hostname)) {
  throw new Error(`E2E de repuestos: SUPABASE_URL (${new URL(url).hostname}) no es un Supabase local; se aborta.`)
}

const cabeceras = (extra: Record<string, string> = {}) => ({
  apikey: serviceKey ?? '',
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
  ...extra,
})

async function rest<T>(ruta: string, cuerpo: unknown, esquema = 'public', prefer = 'return=representation'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    method: 'POST',
    headers: cabeceras({ prefer, 'content-profile': esquema }),
    body: JSON.stringify(cuerpo),
  })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return prefer.includes('return=representation') ? ((await r.json()) as T[]) : []
}

async function leer<T>(ruta: string, esquema = 'public'): Promise<T[]> {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { headers: cabeceras({ 'accept-profile': esquema }) })
  if (!r.ok) throw new Error(`REST ${ruta}: ${r.status} ${await r.text()}`)
  return (await r.json()) as T[]
}

async function borrar(ruta: string, esquema = 'public') {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { method: 'DELETE', headers: cabeceras({ 'content-profile': esquema }) })
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
    headers: { apikey: anonKey ?? serviceKey ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  })
  if (!r.ok) throw new Error(`login de ${correo}: ${r.status} ${await r.text()}`)
  return ((await r.json()) as { access_token: string }).access_token
}

async function rpcComo(token: string, nombre: string, args: Record<string, unknown>) {
  const r = await fetch(`${url}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: anonKey ?? serviceKey ?? '', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { ok: r.ok, texto: await r.text() }
}

test.describe('Service · repuestos con stock por depósito (MSF-217, SC-009)', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')

  test('[MSF-575:T033] agregar descuenta del depósito elegido, quitar devuelve y anular devuelve lo no consumido', async () => {
    const sufijo = randomUUID().slice(0, 8)
    const correo = `rep-stock-${sufijo}@example.com`
    let orgId: string | undefined
    let userId: string | undefined
    try {
      const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E repuestos ${sufijo}` })
      orgId = org.id
      const [empresa] = await rest<{ id: string }>('empresas', { organizacion_id: org.id, nombre: `Tienda ${sufijo}` }, 'dominio')
      userId = await altaUsuario(correo)
      await rest('usuarios_organizacion', { user_id: userId, organizacion_id: org.id, rol_id: 'administrador' })
      await rest('features', { id: 'service-tecnico', nombre: 'Service técnico', descripcion: 'E2E' }, 'public', 'resolution=ignore-duplicates')
      await rest('organizaciones_features', { feature_id: 'service-tecnico', organizacion_id: org.id, habilitado_por: userId })
      const [cliente] = await rest<{ id: string }>('clientes', { organizacion_id: org.id, numero: 1, nombre: `Cliente ${sufijo}`, tipo: 'minorista' })
      const [modelo] = await leer<{ id: string }>(`modelos_equipo?organizacion_id=eq.${org.id}&select=id&limit=1`, 'dominio')
      const [producto] = await rest<{ id: string }>(
        'productos',
        { organizacion_id: org.id, nombre: `Pantalla ${sufijo}`, sku: `REP-${sufijo}`, precio_lista: 100 },
        'dominio',
      )
      const [principal] = await leer<{ id: string }>(`depositos?organizacion_id=eq.${org.id}&por_defecto=eq.true&select=id`, 'dominio')
      const [local] = await rest<{ id: string }>('depositos', { organizacion_id: org.id, nombre: 'Local', activo: true }, 'dominio')
      const motivos = await leer<{ id: string; nombre: string }>(`motivos_movimiento?organizacion_id=eq.${org.id}&select=id,nombre`, 'dominio')
      const motivoEntrada = motivos.find((m) => m.nombre === 'Compra a proveedor')?.id
      expect(motivoEntrada, 'motivo de entrada sembrado').toBeTruthy()

      const token = await tokenDe(correo)
      for (const dep of [principal, local]) {
        const entrada = await rpcComo(token, 'registrar_movimiento_stock', {
          p_producto: producto.id, p_deposito: dep.id, p_tipo: 'entrada', p_cantidad: 5, p_motivo: motivoEntrada,
        })
        expect(entrada.ok, entrada.texto).toBe(true)
      }
      const cantidadEn = async (depositoId: string) =>
        (await leer<{ cantidad: number }>(`existencias_deposito?producto_id=eq.${producto.id}&deposito_id=eq.${depositoId}&select=cantidad`, 'dominio'))[0]?.cantidad

      const alta = await rpcComo(token, 'crear_reparacion', {
        p_empresa_id: empresa.id, p_cliente_id: cliente.id, p_modelo_id: modelo.id, p_falla: 'Pantalla rota',
      })
      expect(alta.ok, alta.texto).toBe(true)
      const reparacionId = (JSON.parse(alta.texto) as { id: string }).id
      const itemsDe = () =>
        leer<{ id: string; stock_estado: string; deposito_id: string | null }>(
          `reparacion_items?reparacion_id=eq.${reparacionId}&select=id,stock_estado,deposito_id&order=creado_en`,
          'dominio',
        )

      // Agregar: el repuesto 2 sale del depósito «Local», el otro queda intacto.
      const a1 = await rpcComo(token, 'agregar_item_reparacion', {
        p_reparacion_id: reparacionId, p_tipo: 'repuesto', p_descripcion: 'Pantalla', p_producto_id: producto.id,
        p_cantidad: 2, p_precio: 50, p_deposito_id: local.id,
      })
      expect(a1.ok, a1.texto).toBe(true)
      expect(await cantidadEn(local.id)).toBe(3)
      expect(await cantidadEn(principal.id)).toBe(5)

      // Barrera: más que lo disponible se rechaza y no mueve nada.
      const exceso = await rpcComo(token, 'agregar_item_reparacion', {
        p_reparacion_id: reparacionId, p_tipo: 'repuesto', p_descripcion: 'Pantalla', p_producto_id: producto.id,
        p_cantidad: 9, p_precio: 50, p_deposito_id: local.id,
      })
      expect(exceso.ok).toBe(false)
      expect(exceso.texto).toContain('No hay stock suficiente')
      expect(await cantidadEn(local.id)).toBe(3)

      // Quitar: el ítem descontado devuelve su cantidad al depósito de origen.
      const [item1] = await itemsDe()
      expect(item1.stock_estado).toBe('descontado')
      const q = await rpcComo(token, 'quitar_item_reparacion', { p_item_id: item1.id })
      expect(q.ok, q.texto).toBe(true)
      expect(await cantidadEn(local.id)).toBe(5)

      // Anular: con un ítem descontado en el principal, la anulación lo devuelve.
      const a2 = await rpcComo(token, 'agregar_item_reparacion', {
        p_reparacion_id: reparacionId, p_tipo: 'repuesto', p_descripcion: 'Pantalla', p_producto_id: producto.id,
        p_cantidad: 3, p_precio: 50, p_deposito_id: principal.id,
      })
      expect(a2.ok, a2.texto).toBe(true)
      expect(await cantidadEn(principal.id)).toBe(2)
      const anulada = await rpcComo(token, 'anular_reparacion', { p_id: reparacionId, p_motivo: 'Cliente desistió', p_consumidos: [] })
      expect(anulada.ok, anulada.texto).toBe(true)
      expect(await cantidadEn(principal.id)).toBe(5)
      expect(await cantidadEn(local.id)).toBe(5)
    } finally {
      if (orgId) await borrar(`organizaciones?id=eq.${orgId}`)
      if (userId) await borrarUsuario(userId)
    }
  })
})
