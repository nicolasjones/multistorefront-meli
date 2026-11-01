import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  obtenerReparacion: vi.fn(),
  listarTecnicos: vi.fn(),
  obtenerDatosTienda: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparaciones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparaciones')>()),
  obtenerReparacion: mocks.obtenerReparacion,
  listarTecnicos: mocks.listarTecnicos,
}))
vi.mock('../../lib/documentosReparacion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/documentosReparacion')>()),
  obtenerDatosTienda: mocks.obtenerDatosTienda,
}))

import type { Reparacion } from '../../lib/reparaciones'
import { armarRemitoEntrega, contactoDeTienda, formatearFechaDocumento } from '../../lib/documentosReparacion'
import { ServicioOrdenIngreso } from './orden-ingreso'
import { ServicioRemitoEntrega } from './remito-entrega'

const TIENDA = { nombre: 'San Javucho', direccion: 'Calle 1', whatsapp: null, correo: 'tienda@example.com' }

const BASE: Reparacion = {
  id: 'r-1', numero: 1, codigo: 'R-0001', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1', cliente: 'Ana Pérez',
  contacto: '11 5555-5555', modelo_id: 'm-1', equipo: 'Nintendo Switch', modelo: 'Lite', estado_id: 's-1', estado: 'Recibido',
  estado_cierra: false, estado_tono: 'neutral', numero_serie: 'SN-1', accesorios: 'Cargador', falla: 'No enciende',
  puede_ver_costos: true, costo_mano_obra: 777, costo_repuestos: 555, tecnico_id: 't-1', ingreso_en: '2026-10-20',
  entrega_prevista: '2026-10-25', entrega_real: null, entregado_por: null, anulada_en: null, anulada_motivo: null,
  updated_at: 't', items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: 999,
}

const ENTREGADA: Reparacion = {
  ...BASE,
  entrega_real: '2026-10-24',
  entregado_por: 'Luis',
  items: [
    { id: 'i-1', tipo: 'mano_obra', descripcion: 'Cambio de pantalla', producto_id: null, sku: null, cantidad: 1, precio_unitario: 20000, subtotal: 20000, deposito_id: null, deposito_nombre: null, stock_estado: 'sin_movimiento' },
    { id: 'i-2', tipo: 'repuesto', descripcion: 'Flex', producto_id: null, sku: null, cantidad: 2, precio_unitario: 1500, subtotal: 3000, deposito_id: null, deposito_nombre: null, stock_estado: 'sin_movimiento' },
  ],
  total_mano_obra: 20000, total_repuestos: 3000, total_cliente: 23000,
}

const abrir = (ruta: 'orden' | 'remito') =>
  render(
    <MemoryRouter initialEntries={[`/service-tecnico/reparaciones/r-1/${ruta}`]}>
      <Routes>
        <Route path="/service-tecnico/reparaciones/:id/orden" element={<ServicioOrdenIngreso />} />
        <Route path="/service-tecnico/reparaciones/:id/remito" element={<ServicioRemitoEntrega />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.obtenerDatosTienda.mockResolvedValue(TIENDA)
  mocks.listarTecnicos.mockResolvedValue([{ user_id: 't-1', nombre: 'Marta Técnica' }])
})

describe('Orden de ingreso (FR-040)', () => {
  it('muestra los datos, las condiciones y los rótulos, sin importes ni costos', async () => {
    mocks.obtenerReparacion.mockResolvedValue(BASE)
    const { container } = abrir('orden')
    expect(await screen.findByRole('heading', { name: 'Orden de ingreso' })).toBeTruthy()
    for (const texto of ['R-0001', '20/10/2026', 'Ana Pérez', '11 5555-5555', 'Nintendo Switch Lite', 'SN-1', 'Cargador', 'No enciende', 'Marta Técnica', '25/10/2026', 'San Javucho', 'Calle 1', 'tienda@example.com']) {
      expect(screen.getByText(texto)).toBeTruthy()
    }
    expect(screen.getByText(/pendiente de confirmar/)).toBeTruthy()
    expect(screen.getByText('Documento no fiscal')).toBeTruthy()
    // WhatsApp no cargado: se omite, no se inventa.
    expect(screen.queryByText(/WhatsApp/)).toBeNull()
    expect(container.textContent).not.toMatch(/777|555,|999|\$/)
  })

  it('llama a window.print al tocar «Imprimir»', async () => {
    mocks.obtenerReparacion.mockResolvedValue(BASE)
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    abrir('orden')
    fireEvent.click(await screen.findByRole('button', { name: 'Imprimir' }))
    expect(imprimir).toHaveBeenCalledTimes(1)
  })

  it('muestra el error con reintento si falla la carga', async () => {
    mocks.obtenerReparacion.mockRejectedValue({ code: 'P0002' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir('orden')
    expect(await screen.findByText('Esa reparación ya no existe. Volvé al listado.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy()
  })
})

describe('Remito de entrega (FR-041)', () => {
  it('muestra tablas, subtotales, total sin IVA, entrega y rótulos, sin costos internos ni ganancia', async () => {
    mocks.obtenerReparacion.mockResolvedValue(ENTREGADA)
    const { container } = abrir('remito')
    expect(await screen.findByRole('heading', { name: 'Remito de entrega' })).toBeTruthy()
    expect(screen.getByText('Cambio de pantalla')).toBeTruthy()
    expect(screen.getByText('Flex')).toBeTruthy()
    expect(container.textContent).toMatch(/Total \(sin IVA\):\s*\$\s*23\.000,00/)
    expect(screen.getByText('24/10/2026')).toBeTruthy()
    expect(screen.getByText('Luis')).toBeTruthy()
    expect(screen.getByText(/Documento no fiscal · Importes sin IVA/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/777|999/)
  })

  it('no está disponible si la reparación no fue entregada', async () => {
    mocks.obtenerReparacion.mockResolvedValue(BASE)
    abrir('remito')
    expect(await screen.findByText('Remito no disponible')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Imprimir' })).toBeNull()
  })

  it('dice «Sin ítems» si no hay ítems', async () => {
    mocks.obtenerReparacion.mockResolvedValue({ ...ENTREGADA, items: [], total_cliente: 0 })
    abrir('remito')
    await waitFor(() => expect(screen.getByText('Sin ítems')).toBeTruthy())
  })
})

describe('lib/documentosReparacion', () => {
  it('formatea fechas sin corrimiento de zona y omite contacto vacío', () => {
    expect(formatearFechaDocumento('2026-10-01')).toBe('01/10/2026')
    expect(formatearFechaDocumento(null)).toBe('—')
    expect(contactoDeTienda({ nombre: 'T', direccion: ' ', whatsapp: '11 1', correo: null })).toEqual(['WhatsApp 11 1'])
  })

  it('el remito no incluye campos de costo interno ni ganancia', () => {
    const json = JSON.stringify(armarRemitoEntrega(ENTREGADA, TIENDA, null))
    expect(json).not.toMatch(/costo_|ganancia/)
  })
})
