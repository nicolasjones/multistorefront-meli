import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ consultar: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/seguimientoPublico', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/seguimientoPublico')>()),
  consultarEstadoReparacion: mocks.consultar,
}))

import { aEstadoPublico } from '../../lib/seguimientoPublico'
import { SeguimientoPage } from './index'

const ESTADO = aEstadoPublico({
  codigo: 'R-0007', tienda: 'San Javucho', equipo: 'Nintendo Switch', modelo: 'Estándar',
  estado: { nombre: 'En reparación', descripcion: 'Estamos trabajando en tu equipo' },
  entrega_prevista: '2027-02-01',
  linea_de_tiempo: [{ estado: 'Recibido', fecha: '2027-01-20T13:00:00Z' }, { estado: 'En reparación', fecha: '2027-01-21T13:00:00Z' }],
  cliente: 'Ana', numero_serie: 'SN-1', falla: 'No enciende', tecnico: 'Lucía',
})

const montar = () => render(
  <MemoryRouter initialEntries={['/seguimiento/' + 'A'.repeat(32)]}>
    <Routes>
      <Route path="/seguimiento/:token" element={<SeguimientoPage />} />
    </Routes>
  </MemoryRouter>,
)

describe('SeguimientoPage (FR-041, FR-045)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('muestra la carga y luego código, tienda, equipo, estado con «Qué significa», entrega y línea de tiempo', async () => {
    mocks.consultar.mockResolvedValue({ tipo: 'ok', estado: ESTADO })
    montar()
    expect(screen.getByRole('status')).toHaveTextContent('Buscando tu reparación')
    expect(await screen.findByRole('heading', { name: 'Reparación R-0007' })).toBeInTheDocument()
    expect(mocks.consultar).toHaveBeenCalledWith('A'.repeat(32))
    expect(screen.getByText('San Javucho')).toBeInTheDocument()
    expect(screen.getByText('Nintendo Switch Estándar')).toBeInTheDocument()
    expect(screen.getAllByText('En reparación').length).toBeGreaterThan(0)
    expect(screen.getByText(/Estamos trabajando en tu equipo/)).toBeInTheDocument()
    expect(screen.getByText('01/02/2027')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Línea de tiempo de estados' }).querySelectorAll('li')).toHaveLength(2)
  })

  it('no muestra campos internos aunque lleguen y no tiene menú ni barra del panel', async () => {
    mocks.consultar.mockResolvedValue({ tipo: 'ok', estado: ESTADO })
    montar()
    await screen.findByRole('heading', { name: 'Reparación R-0007' })
    for (const prohibido of [/Ana/, /SN-1/, /No enciende/, /Lucía/, /Cliente/i, /N\.º de serie/i, /Falla/i, /Técnico/i]) {
      expect(screen.queryByText(prohibido)).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('agrega la meta noindex mientras está montada y la quita al salir', async () => {
    mocks.consultar.mockResolvedValue({ tipo: 'ok', estado: ESTADO })
    const { unmount } = montar()
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', expect.stringContaining('noindex'))
    unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('dice «No encontramos esa reparación» sin datos', async () => {
    mocks.consultar.mockResolvedValue({ tipo: 'no_encontrada' })
    montar()
    expect(await screen.findByText('No encontramos esa reparación')).toBeInTheDocument()
    expect(screen.queryByText('Estado actual')).not.toBeInTheDocument()
  })

  it('dice «Demasiadas consultas, probá en unos minutos» ante el 429', async () => {
    mocks.consultar.mockResolvedValue({ tipo: 'demasiadas', reintentarEn: 60 })
    montar()
    expect(await screen.findByText('Demasiadas consultas, probá en unos minutos')).toBeInTheDocument()
  })

  it('ante un error ofrece «Reintentar» y vuelve a consultar', async () => {
    mocks.consultar.mockResolvedValueOnce({ tipo: 'error' }).mockResolvedValueOnce({ tipo: 'ok', estado: ESTADO })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Reparación R-0007' })).toBeInTheDocument()
    expect(mocks.consultar).toHaveBeenCalledTimes(2)
  })
})
