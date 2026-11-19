import { beforeEach, describe, expect, it, vi } from 'vitest'

// Este archivo NO mockea `crearComprobante`: verifica el dato real que viaja a la RPC (la base exige un canal válido o lanza «Elegí el canal de venta»).
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('./ventas', async (original) => ({ ...(await original<typeof import('./ventas')>()), obtenerComprobante: async () => ({ updated_at: 'sello' }) }))
vi.mock('./ventasLineas', async (original) => ({ ...(await original<typeof import('./ventasLineas')>()), guardarLineasComprobante: async () => undefined }))

import { crearPresupuestoDesdePedido } from './presupuestoDesdePedido'

const CANALES_VALIDOS = ['mostrador', 'tienda_online', 'telefono_whatsapp'] // crear_comprobante (20261203100400)

describe('presupuesto desde un pedido · datos que llegan a crear_comprobante', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.rpc.mockResolvedValue({ data: { id: 'c-1', tipo: 'presupuesto', numero: '00000001' }, error: null })
  })

  it('manda un canal válido (tienda online), el cliente y tipo presupuesto', async () => {
    await crearPresupuestoDesdePedido(
      { empresa_id: 'e-1', cliente_id: 'cl-1', nombre: 'Bruno', contacto: 'b@example.com' },
      [{ orden: 1, producto_id: 'p-1', descripcion: 'Joystick', sku: null, cantidad: 1, precio_referencia: null }],
      'org-1',
    )
    const [nombre, args] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(nombre).toBe('crear_comprobante')
    expect(CANALES_VALIDOS).toContain(args.p_canal)
    expect(args.p_canal).toBe('tienda_online')
    expect(args).toMatchObject({ p_tipo: 'presupuesto', p_cliente_id: 'cl-1', p_empresa_id: 'e-1' })
  })
})
