import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  useCostosAdicionales: vi.fn(),
  recargar: vi.fn(),
  elegirEmpresa: vi.fn(),
  guardar: vi.fn(),
  baja: vi.fn(),
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useCostosAdicionales', () => ({ useCostosAdicionales: mocks.useCostosAdicionales }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/costosAdicionales', async (importarOriginal) => ({
  ...(await importarOriginal<typeof import('../../lib/costosAdicionales')>()),
  guardarCostoAdicional: mocks.guardar,
  darDeBajaCostoAdicional: mocks.baja,
}))

import { RentabilidadCostosAdicionales } from './CostosAdicionales'

const EMPRESAS = [
  { id: 'e1', nombre: 'Mundo JC', esActiva: true },
  { id: 'e2', nombre: 'San Javucho', esActiva: false },
]
const COSTOS = [
  { id: 'c1', empresaId: 'e1', empresaNombre: 'Mundo JC', nombre: 'Impuestos', tipo: 'porcentaje', valor: 5 },
  { id: 'c2', empresaId: 'e1', empresaNombre: 'Mundo JC', nombre: 'Envío', tipo: 'monto', valor: 200 },
]

type Estado = { nivel?: string; empresaActivaId?: string | null; costos?: unknown[]; cargando?: boolean; hayError?: boolean }

const configurar = ({ nivel = 'edicion', empresaActivaId = 'e1', costos = COSTOS, cargando = false, hayError = false }: Estado = {}) => {
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  mocks.useFiltroPorEmpresaActiva.mockReturnValue({
    empresas: EMPRESAS,
    valor: empresaActivaId,
    cambiar: mocks.elegirEmpresa,
    empresaActivaId,
    cargando: false,
    hayError: false,
  })
  mocks.useCostosAdicionales.mockReturnValue({ costos, cargando, hayError, recargar: mocks.recargar })
}

const vista = () => (
  <MemoryRouter>
    <RentabilidadCostosAdicionales />
  </MemoryRouter>
)
const montar = (estado: Estado = {}) => {
  configurar(estado)
  return render(vista())
}

describe('RentabilidadCostosAdicionales', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.guardar.mockResolvedValue(undefined)
    mocks.baja.mockResolvedValue(undefined)
    mocks.recargar.mockResolvedValue(undefined)
  })

  it('lista los costos de la empresa activa con tipo y valor, y la pestaña activa', () => {
    montar()
    const tabla = screen.getByRole('table', { name: 'Costos adicionales' })
    expect(within(tabla).getByText('Impuestos')).toBeInTheDocument()
    expect(within(tabla).getByText('5 %')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 200 por unidad')).toBeInTheDocument()
    expect(mocks.useCostosAdicionales).toHaveBeenCalledWith('e1')
    expect(screen.getByRole('tab', { name: 'Costos adicionales' })).toHaveAttribute('href', '/rentabilidad/costos')
  })

  it('Administración (lectura) los ve pero no hay botones de edición', () => {
    montar({ nivel: 'lectura' })
    expect(screen.getByText('Impuestos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo costo adicional' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Editar / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Dar de baja / })).not.toBeInTheDocument()
  })

  it('muestra carga, error con Reintentar y estado vacío', () => {
    const { unmount } = montar({ cargando: true, costos: [] })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    unmount()
    const error = montar({ hayError: true, costos: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.recargar).toHaveBeenCalledTimes(1)
    error.unmount()
    montar({ costos: [] })
    expect(screen.getByText('Todavía no hay costos adicionales')).toBeInTheDocument()
  })

  it('crea un costo en la empresa activa y recarga la lista', async () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo costo adicional' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo costo adicional' })
    expect(within(dialogo).getByRole('checkbox', { name: 'Mundo JC' })).toBeChecked()
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Tasa' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ }), { target: { value: '2,5' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    expect(mocks.guardar).toHaveBeenCalledWith({}, { id: null, empresaId: 'e1', nombre: 'Tasa', tipo: 'porcentaje', valor: 2.5 })
    expect(await screen.findByText('Costo «Tasa» creado.')).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('crea el mismo costo en varias empresas marcadas', async () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo costo adicional' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo costo adicional' })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'San Javucho' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Envío' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Monto por unidad' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Monto por unidad/ }), { target: { value: '300' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(2))
    expect(mocks.guardar.mock.calls.map((llamada) => llamada[1].empresaId)).toEqual(['e1', 'e2'])
    expect(await screen.findByText('Costo «Envío» creado en 2 empresas.')).toBeInTheDocument()
  })

  it('con falla parcial en varias empresas deja el diálogo abierto con el error de la que falló', async () => {
    mocks.guardar.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ code: '23505' })
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo costo adicional' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo costo adicional' })
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'San Javucho' }))
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Envío' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ }), { target: { value: '5' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText(/San Javucho: /)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nuevo costo adicional' })).toBeInTheDocument()
    expect(await screen.findByText(/creado solo en 1 empresa/)).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('valida con mensajes de negocio y no llama a la base', async () => {
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo costo adicional' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo costo adicional' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(within(dialogo).getByText('Ingresá un nombre para el costo.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Ingresá un valor mayor o igual a 0, por ejemplo 5 o 12,5.')).toBeInTheDocument()
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Tasa' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ }), { target: { value: '101' } })
    expect(within(dialogo).getByText('El porcentaje debe estar entre 0 y 100.')).toBeInTheDocument()
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ }), { target: { value: '-5' } })
    expect(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ })).toHaveValue('5')
    fireEvent.click(within(dialogo).getByRole('checkbox', { name: 'Mundo JC' }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(within(dialogo).getByText('Elegí al menos una empresa a la que aplica.')).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('traduce un nombre repetido de la base y deja el diálogo abierto', async () => {
    mocks.guardar.mockRejectedValue({ code: '23505' })
    montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo costo adicional' })[0])
    const dialogo = await screen.findByRole('dialog', { name: 'Nuevo costo adicional' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Nombre/ }), { target: { value: 'Impuestos' } })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ }), { target: { value: '5' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Mundo JC: Ya hay un costo con ese nombre en Mundo JC.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nuevo costo adicional' })).toBeInTheDocument()
  })

  it('edita un costo: la empresa queda fija y se guarda con su id', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Impuestos' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar costo adicional' })
    expect(within(dialogo).getByRole('checkbox', { name: 'Mundo JC' })).toBeDisabled()
    fireEvent.change(within(dialogo).getByRole('textbox', { name: /Porcentaje sobre el neto/ }), { target: { value: '7' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith({}, { id: 'c1', empresaId: 'e1', nombre: 'Impuestos', tipo: 'porcentaje', valor: 7 }))
    expect(await screen.findByText('Costo «Impuestos» actualizado.')).toBeInTheDocument()
  })

  it('da de baja un costo y recarga', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja Envío' }))
    await waitFor(() => expect(mocks.baja).toHaveBeenCalledWith({}, 'c2'))
    expect(await screen.findByText('Costo «Envío» dado de baja.')).toBeInTheDocument()
    expect(mocks.recargar).toHaveBeenCalled()
  })

  it('si falla la baja avisa con un mensaje claro', async () => {
    mocks.baja.mockRejectedValue({ code: '42501' })
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja Envío' }))
    expect(await screen.findByText('Tu rol no puede editar los costos adicionales de esta empresa.')).toBeInTheDocument()
  })

  it('al cambiar la empresa de la barra superior recarga con la nueva, cierra el diálogo con aviso y no guarda bajo la otra', async () => {
    const { rerender } = montar()
    fireEvent.click(screen.getAllByRole('button', { name: 'Nuevo costo adicional' })[0])
    await screen.findByRole('dialog', { name: 'Nuevo costo adicional' })

    act(() => {
      configurar({ empresaActivaId: 'e2', costos: [] })
      rerender(vista())
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Cambiaste de empresa: cerramos el formulario sin guardar/)).toBeInTheDocument()
    expect(mocks.useCostosAdicionales).toHaveBeenLastCalledWith('e2')
    expect(screen.queryByText('Impuestos')).not.toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })
})
