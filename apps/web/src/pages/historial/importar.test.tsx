import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  subir: vi.fn(),
  rpc: vi.fn(),
  consultar: vi.fn(),
  usePuedeEscribir: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    storage: { from: () => ({ upload: mocks.subir }) },
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.consultar }) }) }),
  },
}))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: () => ({ organizacionId: 'org-1', isLoading: false }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportarHistorial } from './importar'

const abrir = () => render(<MemoryRouter><ImportarHistorial /></MemoryRouter>)
const planilla = (nombre = 'ventas.csv') => new File(['a;b\n1;2'], nombre, { type: 'text/csv' })
const elegir = (archivo: File) => fireEvent.change(screen.getByLabelText(/Planilla a importar/), { target: { files: [archivo] } })

describe('ImportarHistorial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.subir.mockResolvedValue({ error: null })
    mocks.rpc.mockResolvedValue({ data: 'ej-1', error: null })
    mocks.consultar.mockResolvedValue({ data: { id: 'ej-1', estado: 'en_curso', motivo_sanitizado: null, detalle: null }, error: null })
  })

  it('sin permiso de importar no muestra el formulario', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(screen.getByText(/Solo un administrador/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Importar' })).not.toBeInTheDocument()
  })

  it('sube la planilla a la carpeta de la organización y pide la importación del tipo elegido', async () => {
    abrir()
    elegir(planilla())
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    const ruta = mocks.subir.mock.calls[0][0] as string
    expect(ruta).toMatch(/^org-1\/comprobantes\/\d{8}T\d{6}-ventas\.csv$/)
    expect(mocks.rpc).toHaveBeenCalledWith('solicitar_importacion_historial', { p_tipo: 'comprobantes', p_archivo: ruta })
    expect(await screen.findByText(/Importación en curso/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver detalle de la ejecución' })).toHaveAttribute('href', '/ejecuciones/ej-1')
  })

  it('muestra el conteo cuando la ejecución termina bien', async () => {
    mocks.consultar.mockResolvedValue({ data: { id: 'ej-1', estado: 'exitosa', motivo_sanitizado: null, detalle: { nuevas: 8, existentes: 2 } }, error: null })
    abrir()
    elegir(planilla())
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText('Importación terminada.')).toBeInTheDocument()
    expect(screen.getByText('8 registros nuevos y 2 que ya estaban cargados.')).toBeInTheDocument()
  })

  it('muestra el detalle de filas rechazadas cuando la ejecución falla', async () => {
    mocks.consultar.mockResolvedValue({
      data: { id: 'ej-1', estado: 'fallida', motivo_sanitizado: 'ARCHIVO_INVALIDO', detalle: { total_rechazos: 1, rechazos: [{ fila: 4, columna: 'Tienda', motivo: 'La tienda no existe en la organización' }] } },
      error: null,
    })
    abrir()
    elegir(planilla())
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText('No se importó nada: la planilla tiene errores.')).toBeInTheDocument()
    const tabla = screen.getByRole('table', { name: 'Filas rechazadas' })
    expect(tabla).toHaveTextContent('Tienda')
    expect(tabla).toHaveTextContent('La tienda no existe en la organización')
  })

  it('rechaza una planilla inválida sin subirla ni pedir la importación', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText('Elegí la planilla a importar.')).toBeInTheDocument()
    elegir(planilla('ventas.pdf'))
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText(/\.csv o \.xlsx/)).toBeInTheDocument()
    expect(mocks.subir).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('informa una importación simultánea y no queda en curso', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'YA_EN_CURSO: ya hay una importación de comprobantes en curso' } })
    abrir()
    elegir(planilla())
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText(/Ya hay una importación de ese tipo en curso/)).toBeInTheDocument()
    expect(screen.queryByText(/Importación en curso\./)).not.toBeInTheDocument()
  })

  it('informa el error de subida y no pide la importación', async () => {
    mocks.subir.mockResolvedValue({ error: { message: 'boom' } })
    abrir()
    elegir(planilla())
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    expect(await screen.findByText('No pudimos subir la planilla. Intentá de nuevo.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('es operable con teclado: el tipo y el archivo tienen etiqueta accesible y el envío es un botón', () => {
    abrir()
    expect(screen.getByLabelText('Tipo de planilla')).toBeInTheDocument()
    expect(screen.getByLabelText(/Planilla a importar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importar' })).toHaveAttribute('type', 'submit')
  })
})
