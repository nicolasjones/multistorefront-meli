import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useResponsablesConsultas: vi.fn(),
  actualizarConsulta: vi.fn(),
  onCerrar: vi.fn(),
  onGuardado: vi.fn(),
  onRecargar: vi.fn(),
}))

vi.mock('../../hooks/useConsultas', () => ({ useResponsablesConsultas: mocks.useResponsablesConsultas }))
// El contacto de la libreta (F-CON-05) tiene su propio test: acá no se monta.
vi.mock('../../pages/consultas/ContactoConsulta', () => ({ ContactoConsulta: () => null }))
vi.mock('../../lib/consultas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/consultas')>()),
  actualizarConsulta: mocks.actualizarConsulta,
}))

import { ErrorConsulta, type Consulta } from '../../lib/consultas'
import { DetalleConsulta } from './DetalleConsulta'

const consulta = (extra: Partial<Consulta> = {}): Consulta => ({
  id: 'c1000000-0000-0000-0000-000000000001',
  empresa_id: 'e-1',
  empresa_nombre: 'San Javucho',
  origen: 'formulario',
  nombre: 'Ana Pérez',
  contacto: 'ana@example.com',
  mensaje: 'Hola, ¿tienen stock?',
  producto_id: null,
  producto_nombre: null,
  estado: 'nueva',
  responsable_id: null,
  responsable_nombre: null,
  nota_interna: null,
  created_at: '2026-10-23T11:48:00.000Z',
  updated_at: '2026-10-23T11:48:00.000Z',
  ...extra,
})

const abrir = (fila: Consulta = consulta(), puedeEditar = true) => {
  const resultado = render(
    <DetalleConsulta
      consulta={fila}
      puedeEditar={puedeEditar}
      onCerrar={mocks.onCerrar}
      onGuardado={mocks.onGuardado}
      onRecargar={mocks.onRecargar}
    />,
  )
  return { ...resultado, dialogo: screen.getByRole('dialog') }
}

const elegir = (etiqueta: string, opcion: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: etiqueta }))
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: opcion }))
}

describe('DetalleConsulta (F-CON-01, FR-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useResponsablesConsultas.mockReturnValue({
      responsables: [{ user_id: 'u-1', nombre: 'Ana Responsable' }, { user_id: 'u-2', nombre: 'Beto' }],
      isLoading: false,
      isError: false,
    })
    mocks.actualizarConsulta.mockResolvedValue('2026-10-23T12:00:00.000Z')
  })

  it('muestra el título, los chips, contacto, producto, mensaje y fecha', () => {
    abrir(consulta({ producto_nombre: 'Funda', mensaje: 'Quiero una funda' }))
    expect(screen.getByText('Consulta de Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText('San Javucho')).toBeInTheDocument()
    expect(screen.getByText('Formulario')).toBeInTheDocument()
    expect(screen.getAllByText('Nueva').length).toBeGreaterThan(0)
    expect(screen.getByText('ana@example.com')).toBeInTheDocument()
    expect(screen.getByText('Funda')).toBeInTheDocument()
    expect(screen.getByText('Quiero una funda')).toBeInTheDocument()
  })

  it('un WhatsApp sin mensaje muestra el texto del prototipo', () => {
    abrir(consulta({ origen: 'whatsapp', mensaje: null }))
    expect(screen.getByText(/No dejó mensaje/)).toBeInTheDocument()
  })

  it('ofrece «Responder por correo» o «por WhatsApp» según el contacto (detalle en responder.test.tsx)', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Responder por correo' })).toBeEnabled()
  })

  it('con lectura no deja cambiar nada y no muestra «Guardar»', () => {
    const { dialogo } = abrir(consulta(), false)
    expect(screen.getByRole('combobox', { name: 'Estado' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Nota interna')).toBeDisabled()
    expect(screen.getByText(/Solo lectura: tu rol puede ver las consultas pero no cambiarlas/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(mocks.useResponsablesConsultas).toHaveBeenCalledWith(null)
    expect(within(dialogo).getAllByRole('button', { name: 'Cerrar' })).toHaveLength(2)
  })

  it('asignar, anotar y resolver envía estado, responsable y nota con el sello leído', async () => {
    const { dialogo } = abrir(consulta({ updated_at: '2026-10-23T11:48:00.000Z' }))
    elegir('Estado', 'Resuelta')
    elegir('Responsable', 'Beto')
    fireEvent.change(within(dialogo).getByLabelText('Nota interna'), { target: { value: '  Llamar mañana  ' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.actualizarConsulta).toHaveBeenCalledWith({
      id: 'c1000000-0000-0000-0000-000000000001',
      estado: 'resuelta',
      responsableId: 'u-2',
      nota: '  Llamar mañana  ',
      actualizadoEn: '2026-10-23T11:48:00.000Z',
    }))
    await waitFor(() => expect(mocks.onGuardado).toHaveBeenCalledWith('Consulta guardada · Ana Pérez'))
  })

  it('un conflicto de edición avisa y ofrece recargar sin perder el diálogo', async () => {
    mocks.actualizarConsulta.mockRejectedValue(new ErrorConsulta('conflict', '40001'))
    const { dialogo } = abrir()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La consulta cambió.')).toBeInTheDocument()
    expect(screen.getByText(/Otra persona modificó esta consulta/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(mocks.onRecargar).toHaveBeenCalledTimes(1)
    expect(mocks.onGuardado).not.toHaveBeenCalled()
  })

  it('un error de permisos o de datos se muestra claro y no falla en silencio', async () => {
    mocks.actualizarConsulta.mockRejectedValue(new ErrorConsulta('permission denied', '42501'))
    const { dialogo } = abrir()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No se guardó la consulta.')).toBeInTheDocument()
    expect(screen.getByText('No tenés permiso para editar esta consulta.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recargar' })).not.toBeInTheDocument()
  })

  it('si la persona asignada ya no es elegible se la sigue mostrando para no perderla', () => {
    abrir(consulta({ responsable_id: 'u-9', responsable_nombre: 'Persona anterior' }))
    expect(screen.getByRole('combobox', { name: 'Responsable' })).toHaveTextContent('Persona anterior')
  })

  it('con un responsable no elegible se puede guardar el estado sin reasignar', async () => {
    const { dialogo } = abrir(consulta({ responsable_id: 'u-9', responsable_nombre: 'Persona anterior' }))
    elegir('Estado', 'En curso')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.actualizarConsulta).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'en_curso', responsableId: 'u-9' }),
    ))
  })

  it('«Cerrar» cierra el diálogo', () => {
    const { dialogo } = abrir()
    fireEvent.click(within(dialogo).getAllByRole('button', { name: 'Cerrar' })[0])
    expect(mocks.onCerrar).toHaveBeenCalledTimes(1)
  })
})
