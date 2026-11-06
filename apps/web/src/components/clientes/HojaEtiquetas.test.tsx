import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ select: vi.fn(), from: vi.fn(), print: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { from: mocks.from } }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'o-1' } }) }))

import { HojaEtiquetas } from './HojaEtiquetas'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const filas = [
  { id: ID_A, nombre: 'Distribuidora Norte SRL', direccion: 'Av. Siempre Viva 742', codigo_postal: '2000', localidad: 'Rosario', provincia: 'Santa Fe', telefono: '341 555 0101', expreso_preferido: 'Vía Cargo' },
  { id: ID_B, nombre: 'Sin Calle SA', direccion: null, codigo_postal: null, localidad: 'Rosario', provincia: null, telefono: null, expreso_preferido: null },
]

const Destino = () => <div>Destino {useLocation().pathname} {JSON.stringify(useLocation().state)}</div>
const abrir = (ids: string[]) => render(
  <MemoryRouter initialEntries={[{ pathname: '/clientes/etiquetas', search: `?ids=${ids.join(',')}`, state: { volverA: '/clientes/show/c-1' } }]}>
    <Routes>
      <Route path="/clientes/etiquetas" element={<HojaEtiquetas />} />
      <Route path="/clientes/show/:id" element={<Destino />} />
    </Routes>
  </MemoryRouter>,
)

describe('HojaEtiquetas (F-CLI-17, FR-001, FR-002, FR-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.print = mocks.print
    mocks.select.mockReset()
    mocks.from.mockReturnValue({ select: () => ({ in: mocks.select }) })
    mocks.select.mockImplementation(async (_col: string, ids: string[]) => ({ data: filas.filter((f) => ids.includes(f.id)), error: null }))
  })

  it('arma una etiqueta por cliente con nombre, dirección, CP, localidad, provincia, teléfono y transporte', async () => {
    abrir([ID_A])
    const etiqueta = await screen.findByRole('article', { name: 'Etiqueta de Distribuidora Norte SRL' })
    for (const texto of ['Av. Siempre Viva 742', '2000 Rosario', 'Santa Fe', 'Tel. 341 555 0101', 'Transporte: Vía Cargo']) {
      expect(within(etiqueta).getByText(texto)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(mocks.from).toHaveBeenCalledWith('clientes')
  })

  it('solo lee: no escribe en la base', async () => {
    abrir([ID_A])
    await screen.findByRole('article')
    expect(mocks.from.mock.results[0].value).not.toHaveProperty('insert')
    expect(mocks.from.mock.results[0].value).not.toHaveProperty('update')
  })

  it('la hoja trae @page y @media print que ocultan lo que no es etiqueta', async () => {
    abrir([ID_A])
    await screen.findByRole('article')
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('')
    expect(css).toContain('@page')
    expect(css).toContain('@media print')
    expect(css).toContain('.no-imprimir')
  })

  it('en selección omite al cliente sin dirección y lo nombra en el aviso', async () => {
    abrir([ID_A, ID_B])
    await screen.findByRole('article', { name: 'Etiqueta de Distribuidora Norte SRL' })
    expect(screen.queryByRole('article', { name: 'Etiqueta de Sin Calle SA' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Sin Calle SA (falta dirección)')
  })

  it('CA-CLI-17-1: si ninguno es apto avisa el dato faltante y no genera hoja', async () => {
    abrir([ID_B])
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin Calle SA (falta dirección)')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Etiquetas de envío' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
  })

  it('imprimir abre el diálogo, avisa «Etiqueta enviada a imprimir» y vuelve con ese aviso', async () => {
    abrir([ID_A])
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(mocks.print).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Etiqueta enviada a imprimir')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(await screen.findByText(/Destino \/clientes\/show\/c-1/)).toHaveTextContent('Etiqueta enviada a imprimir')
  })

  it('sin ids válidos muestra el estado vacío y no consulta', async () => {
    abrir(['no-es-uuid'])
    expect(await screen.findByText('No hay clientes para imprimir.')).toBeInTheDocument()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('si la lectura falla muestra el error con reintento', async () => {
    mocks.select.mockResolvedValueOnce({ data: null, error: new Error('x') })
    abrir([ID_A])
    expect(await screen.findByText('No pudimos cargar los clientes.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(screen.getByRole('article')).toBeInTheDocument())
  })
})
