import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useFichaContacto: vi.fn(),
  useHistorialContacto: vi.fn(),
  useEmpresaActivaCambio: vi.fn(),
  useNivelSeccion: vi.fn(),
  actualizarContacto: vi.fn(),
  vincularComprobante: vi.fn(),
  refetch: vi.fn(),
  refetchHistorial: vi.fn(),
}))

vi.mock('../../hooks/useContactos', () => ({
  useFichaContacto: mocks.useFichaContacto,
  useHistorialContacto: mocks.useHistorialContacto,
  useEmpresaActivaCambio: mocks.useEmpresaActivaCambio,
  AVISO_CAMBIO_EMPRESA: 'aviso de cambio',
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/contactos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/contactos')>()),
  actualizarContacto: mocks.actualizarContacto,
  vincularComprobante: mocks.vincularComprobante,
}))
vi.mock('./VincularComprobanteDialog', () => ({ VincularComprobanteDialog: () => <div>dialogo vincular</div> }))
vi.mock('./AnonimizarContactoDialog', () => ({ AnonimizarContactoDialog: () => <div>dialogo anonimizar</div> }))

import { ErrorContacto, type FichaContacto } from '../../lib/contactos'
import { ContactoFicha } from './ficha'

const ID = 'a1000000-0000-0000-0000-000000000001'
const ficha = (extra: Partial<FichaContacto> = {}): FichaContacto => ({
  id: ID, empresa_id: 'e-1', nombre: 'Ana Pérez', correo: 'ana@example.com', telefono: null,
  consentimiento_en: '2026-10-23T11:48:00.000Z', consentimiento_texto: 'texto', anonimizado_en: null,
  updated_at: '2026-10-23T11:48:00.000Z', ...extra,
})
const historial = [
  { tipo: 'consulta', referencia_id: 'c-1', fecha: '2026-10-23T11:48:00.000Z', empresa_id: 'e-1', empresa_nombre: 'San Javucho', resumen: 'Hola, ¿tienen stock?', estado: 'nueva', total: null },
  { tipo: 'compra', referencia_id: 'd-1', fecha: '2026-10-20T00:00:00.000Z', empresa_id: 'e-1', empresa_nombre: 'San Javucho', resumen: 'Factura 0001-00000001', estado: 'emitida', total: 1210 },
]

const abrir = () =>
  render(
    <MemoryRouter initialEntries={[`/contactos/${ID}`]}>
      <Routes>
        <Route path="/contactos/:id" element={<ContactoFicha />} />
        <Route path="/contactos" element={<div>La libreta</div>} />
      </Routes>
    </MemoryRouter>,
  )

describe('ContactoFicha (F-CON-05, FR-006, FR-008, FR-010, FR-012)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useEmpresaActivaCambio.mockReturnValue(false)
    mocks.useFichaContacto.mockReturnValue({ ficha: ficha(), isLoading: false, isError: false, noEncontrado: false, refetch: mocks.refetch })
    mocks.useHistorialContacto.mockReturnValue({ historial, isLoading: false, isError: false, refetch: mocks.refetchHistorial })
    mocks.actualizarContacto.mockResolvedValue('2026-10-23T12:00:00.000Z')
    mocks.vincularComprobante.mockResolvedValue(undefined)
  })

  it('muestra los datos y el historial de consultas y compras', () => {
    abrir()
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Pérez')
    expect(screen.getByText(/Consulta · Hola, ¿tienen stock\?/)).toBeInTheDocument()
    expect(screen.getByText(/Compra · Factura 0001-00000001/)).toBeInTheDocument()
  })

  it('guarda con el sello vigente y recarga la ficha', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana P. G.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalled())
    expect(mocks.actualizarContacto).toHaveBeenCalledWith(expect.objectContaining({
      id: ID, nombre: 'Ana P. G.', actualizadoEn: '2026-10-23T11:48:00.000Z',
    }))
  })

  it('un conflicto de edición se explica y ofrece recargar', async () => {
    mocks.actualizarContacto.mockRejectedValue(new ErrorContacto('x', '40001'))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/Otra persona modificó este contacto/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('desvincula una compra y relee el historial', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular' }))
    await waitFor(() => expect(mocks.vincularComprobante).toHaveBeenCalledWith('d-1', null))
    await waitFor(() => expect(mocks.refetchHistorial).toHaveBeenCalled())
  })

  it('«Anonimizar» abre el diálogo de confirmación', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Anonimizar' }))
    expect(screen.getByText('dialogo anonimizar')).toBeInTheDocument()
  })

  it('un contacto anonimizado se ve en solo lectura con la marca «Anonimizado»', () => {
    mocks.useFichaContacto.mockReturnValue({
      ficha: ficha({ nombre: 'Anonimizado', correo: null, anonimizado_en: '2026-10-24T10:00:00.000Z' }),
      isLoading: false, isError: false, noEncontrado: false, refetch: mocks.refetch,
    })
    abrir()
    expect(screen.getByText('Anonimizado', { selector: '.MuiChip-label' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Anonimizar' })).not.toBeInTheDocument()
  })

  it('con lectura los botones están deshabilitados', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Anonimizar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Vincular comprobante' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Desvincular' })).not.toBeInTheDocument()
  })

  it('un contacto inexistente o sin acceso muestra el vacío, no un error', () => {
    mocks.useFichaContacto.mockReturnValue({ ficha: null, isLoading: false, isError: false, noEncontrado: true, refetch: mocks.refetch })
    abrir()
    expect(screen.getByText('No encontramos ese contacto.')).toBeInTheDocument()
  })

  it('si cambia la empresa activa vuelve a la libreta y no deja datos de la anterior', () => {
    mocks.useEmpresaActivaCambio.mockReturnValue(true)
    abrir()
    expect(screen.getByText('La libreta')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
  })
})
