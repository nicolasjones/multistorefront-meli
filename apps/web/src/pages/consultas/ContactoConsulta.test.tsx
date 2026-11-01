import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useFichaContacto: vi.fn(),
  useEmpresaActivaCambio: vi.fn(),
  crearContacto: vi.fn(),
  leerContacto: vi.fn(),
  vincularConsulta: vi.fn(),
  onVinculada: vi.fn(),
}))

vi.mock('../../hooks/useContactos', () => ({
  useFichaContacto: mocks.useFichaContacto,
  useEmpresaActivaCambio: mocks.useEmpresaActivaCambio,
  AVISO_CAMBIO_EMPRESA: 'aviso',
}))
vi.mock('../../lib/contactos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/contactos')>()),
  crearContacto: mocks.crearContacto,
  leerContacto: mocks.leerContacto,
  vincularConsulta: mocks.vincularConsulta,
}))

import { ErrorContacto } from '../../lib/contactos'
import type { Consulta } from '../../lib/consultas'
import { TEXTO_CONSENTIMIENTO } from '../../lib/consentimientoContacto'
import { ContactoConsulta } from './ContactoConsulta'

const consulta = (extra: Partial<Consulta> = {}): Consulta => ({
  id: 'c-1', empresa_id: 'e-1', empresa_nombre: 'San Javucho', origen: 'formulario', nombre: 'Ana Pérez',
  contacto: 'ana@example.com', mensaje: 'Hola', producto_id: null, producto_nombre: null, estado: 'nueva',
  responsable_id: null, responsable_nombre: null, nota_interna: null,
  created_at: '2026-10-23T11:48:00.000Z', updated_at: '2026-10-23T11:48:00.000Z', ...extra,
})

const abrir = (fila = consulta(), puedeEditar = true) =>
  render(<MemoryRouter><ContactoConsulta consulta={fila} puedeEditar={puedeEditar} onVinculada={mocks.onVinculada} /></MemoryRouter>)

describe('ContactoConsulta y CrearContactoDialog (F-CON-05, FR-002…FR-004, FR-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useFichaContacto.mockReturnValue({ ficha: null })
    mocks.useEmpresaActivaCambio.mockReturnValue(false)
    mocks.crearContacto.mockResolvedValue('k-1')
    mocks.vincularConsulta.mockResolvedValue(undefined)
  })

  it('con la consulta ya vinculada muestra el enlace a la ficha en vez de «Crear contacto»', () => {
    mocks.useFichaContacto.mockReturnValue({ ficha: { nombre: 'Ana Pérez' } })
    abrir(consulta({ contacto_id: 'k-9' }))
    expect(screen.getByRole('link', { name: 'Ana Pérez' })).toHaveAttribute('href', '/contactos/k-9')
    expect(screen.queryByRole('button', { name: 'Crear contacto' })).not.toBeInTheDocument()
  })

  it('con lectura «Crear contacto» está deshabilitado', () => {
    abrir(consulta(), false)
    expect(screen.getByRole('button', { name: 'Crear contacto' })).toBeDisabled()
  })

  it('precarga nombre y correo (o teléfono según el formato) de la consulta', () => {
    const { unmount } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }))
    expect(screen.getByLabelText(/Nombre/)).toHaveValue('Ana Pérez')
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@example.com')
    expect(screen.getByLabelText('Teléfono')).toHaveValue('')
    unmount()
    abrir(consulta({ contacto: '+54 9 11 5555-1234' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }))
    expect(screen.getByLabelText('Teléfono')).toHaveValue('+54 9 11 5555-1234')
    expect(screen.getByLabelText('Correo')).toHaveValue('')
  })

  it('sin consentimiento no guarda', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contacto' }))
    expect(screen.getAllByText('Confirmá el consentimiento para guardar el contacto.').length).toBeGreaterThan(0)
    expect(mocks.crearContacto).not.toHaveBeenCalled()
  })

  it('con consentimiento crea el contacto vinculado a la consulta, copiando el texto vigente', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contacto' }))
    await waitFor(() => expect(mocks.onVinculada).toHaveBeenCalled())
    expect(mocks.crearContacto).toHaveBeenCalledWith(expect.objectContaining({
      empresaId: 'e-1', consultaId: 'c-1', consentimiento: true, consentimientoTexto: TEXTO_CONSENTIMIENTO, nombre: 'Ana Pérez',
    }))
  })

  it('ante un duplicado muestra el existente y ofrece vincular la consulta a él', async () => {
    const existente = 'e1000000-0000-0000-0000-00000000000b'
    mocks.crearContacto.mockRejectedValue(new ErrorContacto('dup', '23505', existente))
    mocks.leerContacto.mockResolvedValue({ id: existente, nombre: 'Ana Antigua' })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contacto' }))
    expect(await screen.findByRole('link', { name: 'Ana Antigua' })).toHaveAttribute('href', `/contactos/${existente}`)
    fireEvent.click(screen.getByRole('button', { name: 'Vincular la consulta al existente' }))
    await waitFor(() => expect(mocks.vincularConsulta).toHaveBeenCalledWith('c-1', existente))
    await waitFor(() => expect(mocks.onVinculada).toHaveBeenCalled())
  })

  it('si cambia la empresa activa el formulario se cierra con aviso', async () => {
    const { rerender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Crear contacto' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    mocks.useEmpresaActivaCambio.mockReturnValue(true)
    rerender(<MemoryRouter><ContactoConsulta consulta={consulta()} puedeEditar onVinculada={mocks.onVinculada} /></MemoryRouter>)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.crearContacto).not.toHaveBeenCalled()
  })
})
