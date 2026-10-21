import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePuedeEscribir: vi.fn(),
  useOrganizacionDeTrabajo: vi.fn(),
  solicitar: vi.fn(),
  consultar: vi.fn(),
}))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useOrganizacionDeTrabajo', () => ({ useOrganizacionDeTrabajo: mocks.useOrganizacionDeTrabajo }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/historial', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/historial')>()
  return {
    ...actual,
    solicitarImportacionHistorial: mocks.solicitar,
    consultarEjecucionHistorial: mocks.consultar,
  }
})

import { HistorialImportar } from './importar'

const abrir = () => render(<MemoryRouter><HistorialImportar /></MemoryRouter>)

const planilla = (nombre = 'comprobantes.csv', tipo = 'text/csv') => new File(['fecha,cliente,total\n2020-01-01,Ana,100'], nombre, { type: tipo })

const ejecucion = (parcial: Record<string, unknown>) => ({
  id: 'ej-1',
  estado: 'exitosa',
  motivo_sanitizado: null,
  detalle: {},
  iniciada_en: '2026-10-20T12:00:00Z',
  finalizada_en: '2026-10-20T12:01:00Z',
  ...parcial,
})

describe('HistorialImportar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useOrganizacionDeTrabajo.mockReturnValue({ organizacionId: 'org-1', isLoading: false })
    mocks.solicitar.mockResolvedValue({ ejecucionId: 'ej-1', ruta: 'org-1/archivo.csv' })
    mocks.consultar.mockResolvedValue(ejecucion({ detalle: { nuevas: 12, existentes: 3 } }))
  })

  it('sube la planilla, inicia la ejecución y muestra el conteo', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Planilla del historial'), { target: { files: [planilla()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    expect(await screen.findByText('Importación completada')).toBeInTheDocument()
    expect(screen.getByText('Se importaron 12 registros nuevos. 3 ya existían y no se duplicaron.')).toBeInTheDocument()
    expect(mocks.solicitar).toHaveBeenCalledWith(expect.anything(), {
      organizacionId: 'org-1',
      tipo: 'comprobantes',
      archivo: expect.any(File),
    })
    expect(screen.getByRole('link', { name: 'Ver en Ejecuciones' })).toHaveAttribute('href', '/ejecuciones/ej-1')
  })

  it('muestra el detalle de filas rechazadas cuando la importación falla', async () => {
    mocks.consultar.mockResolvedValue(ejecucion({
      estado: 'fallida',
      detalle: {
        total_rechazos: 37,
        rechazos_truncados: true,
        rechazos: [{ fila: 2, columna: 'fecha', motivo: 'Fecha inválida' }],
      },
    }))
    abrir()
    fireEvent.change(screen.getByLabelText('Planilla del historial'), { target: { files: [planilla('cobros.csv')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    expect(await screen.findByText('La importación no se aplicó')).toBeInTheDocument()
    expect(screen.getByText('37 filas rechazadas. No se importó ningún registro: corregí la planilla y volvé a intentar.')).toBeInTheDocument()

    const tabla = screen.getByRole('table', { name: 'Filas rechazadas' })
    expect(tabla).toBeInTheDocument()
    expect(screen.getByText('Fecha inválida')).toBeInTheDocument()
    expect(screen.getByText(/Se muestran los primeros 1 de 37 rechazos/)).toBeInTheDocument()
  })

  it('muestra el estado en curso y el enlace a Ejecuciones', async () => {
    mocks.consultar.mockResolvedValue(ejecucion({ estado: 'en_curso', finalizada_en: null }))
    abrir()
    fireEvent.change(screen.getByLabelText('Planilla del historial'), { target: { files: [planilla()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    expect(await screen.findByText('Importación en curso')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver en Ejecuciones' })).toBeInTheDocument()
  })

  it('no permite importar sin archivo', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()
    expect(mocks.solicitar).not.toHaveBeenCalled()
  })

  it('rechaza un archivo que no es CSV o Excel antes de subirlo', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Planilla del historial'), { target: { files: [planilla('historial.pdf', 'application/pdf')] } })

    expect(screen.getByRole('alert')).toHaveTextContent('«historial.pdf» no es un archivo .csv o .xlsx.')
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))
    await waitFor(() => expect(mocks.solicitar).not.toHaveBeenCalled())
  })

  it('sin permiso de importar muestra el acceso restringido y no el formulario', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()

    expect(screen.getByText('Solo un administrador con una organización activa puede importar el historial.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Planilla del historial')).not.toBeInTheDocument()
  })

  it('muestra el error de la solicitud sin exponer detalles técnicos', async () => {
    mocks.solicitar.mockRejectedValue(new Error('Ya hay una importación de este tipo en curso. Esperá a que termine.'))
    abrir()
    fireEvent.change(screen.getByLabelText('Planilla del historial'), { target: { files: [planilla()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    expect(await screen.findByText('No pudimos iniciar la importación.')).toBeInTheDocument()
    expect(screen.getByText('Ya hay una importación de este tipo en curso. Esperá a que termine.')).toBeInTheDocument()
  })
})
