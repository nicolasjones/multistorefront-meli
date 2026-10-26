import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useReportesAsignados: vi.fn(),
  useNivelSeccion: vi.fn(),
  useEmpresas: vi.fn(),
  useConteoMargen: vi.fn(),
  recargarConteo: vi.fn(),
  useUmbralMargen: vi.fn(),
  guardar: vi.fn(),
  montajes: vi.fn(),
  propsReporte: { current: null as null | { reporteId: string; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void } },
}))
vi.mock('../../hooks/useReportesAsignados', () => ({ useReportesAsignados: mocks.useReportesAsignados }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useEmpresas', () => ({ useEmpresas: mocks.useEmpresas }))
vi.mock('../../hooks/useRentabilidad', () => ({
  useConteoMargen: mocks.useConteoMargen,
  useUmbralMargen: mocks.useUmbralMargen,
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => <span>Organización: Uno</span> }))
vi.mock('../acceso-restringido/AccesoRestringido', () => ({
  AccesoRestringido: ({ seccion }: { seccion: string }) => <div>Acceso restringido a {seccion}</div>,
}))
// El tablero real monta un iframe de Superset y pide token: acá se simula montaje y fallo.
vi.mock('../../components/ReporteEmbebido', async () => {
  const { useEffect } = await import('react')
  return {
    ReporteEmbebido: (props: { reporteId: string; alFallar?: (motivo: 'prohibido' | 'no_disponible') => void }) => {
      mocks.propsReporte.current = props
      useEffect(() => { mocks.montajes(props.reporteId) }, [props.reporteId])
      return <div data-testid="tablero">Tablero {props.reporteId}</div>
    },
  }
})

import { notificarEmpresaActivaCambiada } from '../../lib/empresaActivaRevision'
import { RentabilidadResumen } from './index'

const REPORTE = { id: 'rep-resumen', nombre: 'Rentabilidad · Resumen' }
const CON_BAJOS = { conMargenBajo: 1, conMargenNegativo: 0, productosConMargen: 20 }
const SIN_BAJOS = { conMargenBajo: 0, conMargenNegativo: 0, productosConMargen: 20 }

function Ubicacion() {
  const ubicacion = useLocation()
  return <p data-testid="ubicacion">{ubicacion.pathname}{ubicacion.search}</p>
}

const montar = ({
  nivel = 'edicion',
  reportes = [REPORTE],
  cargandoReportes = false,
  conteo = CON_BAJOS as unknown,
  hayErrorConteo = false,
}: { nivel?: string; reportes?: unknown[]; cargandoReportes?: boolean; conteo?: unknown; hayErrorConteo?: boolean } = {}) => {
  mocks.useReportesAsignados.mockReturnValue({ reportes, isLoading: cargandoReportes })
  mocks.useNivelSeccion.mockReturnValue({ nivel, isLoading: false })
  mocks.useEmpresas.mockReturnValue({
    empresas: [
      { id: 'e1', nombre: 'San Javucho', activa: true },
      { id: 'e2', nombre: 'Mundo JC', activa: true },
      { id: 'e3', nombre: 'Pausada', activa: false },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
  mocks.useConteoMargen.mockReturnValue({ conteo, hayError: hayErrorConteo, recargar: mocks.recargarConteo })
  mocks.useUmbralMargen.mockReturnValue({
    umbral: { umbral: 0.1, actualizadoEn: '2026-12-01T10:00:00Z' },
    hayError: false,
    guardando: false,
    recargar: vi.fn(),
    guardar: mocks.guardar,
  })
  return render(
    <MemoryRouter initialEntries={['/rentabilidad']}>
      <Routes>
        <Route path="/rentabilidad" element={<><RentabilidadResumen /><Ubicacion /></>} />
        <Route path="/rentabilidad/productos" element={<Ubicacion />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RentabilidadResumen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.propsReporte.current = null
    mocks.guardar.mockResolvedValue({ ok: true })
  })

  it('muestra título, subtítulo, pestañas Resumen y Por producto (sin Mercado Libre) y embebe el tablero', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Rentabilidad' })).toBeInTheDocument()
    expect(screen.getByText('Margen estimado por canal, producto y publicación.')).toBeInTheDocument()
    expect(screen.getByText('Organización: Uno')).toBeInTheDocument()
    const pestanas = screen.getByRole('tablist', { name: 'Secciones de Rentabilidad' })
    expect(within(pestanas).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Resumen', 'Por producto'])
    expect(within(pestanas).getByRole('tab', { name: 'Por producto' })).toHaveAttribute('href', '/rentabilidad/productos')
    expect(screen.getByTestId('tablero')).toHaveTextContent('Tablero rep-resumen')
    expect(screen.queryByText(/Mercado Libre/)).not.toBeInTheDocument()
    expect(screen.queryByText(/por publicación de ML/i)).not.toBeInTheDocument()
  })

  it('incluye «Cómo se calcula» con una fila por tienda activa', () => {
    montar()
    const tabla = screen.getByRole('table', { name: 'Precio y comisión por canal' })
    expect(within(tabla).getByText('San Javucho')).toBeInTheDocument()
    expect(within(tabla).getByText('Mundo JC')).toBeInTheDocument()
    expect(within(tabla).queryByText('Pausada')).not.toBeInTheDocument()
  })

  it('muestra el aviso con productos bajos o negativos y «Ver detalle» navega a Por producto con el filtro', () => {
    montar()
    expect(screen.getByText('Hay productos que se venden por debajo del costo o casi. Revisalos en Por producto.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Ver detalle' }))
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/rentabilidad/productos?estado=bajo_o_negativo')
  })

  it('también avisa si solo hay negativos', () => {
    montar({ conteo: { conMargenBajo: 0, conMargenNegativo: 2, productosConMargen: 5 } })
    expect(screen.getByRole('link', { name: 'Ver detalle' })).toBeInTheDocument()
  })

  it('oculta el aviso sin bajos ni negativos', () => {
    montar({ conteo: SIN_BAJOS })
    expect(screen.queryByText(/Hay productos que se venden por debajo del costo/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver detalle' })).not.toBeInTheDocument()
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
  })

  it('sin ningún margen calculado muestra el estado vacío compartido y no monta el tablero', () => {
    montar({ conteo: { conMargenBajo: 0, conMargenNegativo: 0, productosConMargen: 0 } })
    expect(screen.getByText('Todavía no hay productos con margen calculado')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver detalle' })).not.toBeInTheDocument()
  })

  it('mientras carga muestra el estado de carga compartido', () => {
    montar({ conteo: null })
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('si el conteo falla igual muestra el tablero, sin aviso', () => {
    montar({ conteo: null, hayErrorConteo: true })
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver detalle' })).not.toBeInTheDocument()
  })

  it('si el tablero no está asignado a la organización lo dice sin detalle técnico', () => {
    montar({ reportes: [{ id: 'otro', nombre: 'Ventas mensuales' }] })
    expect(screen.getByText('El tablero de Rentabilidad todavía no está disponible para tu organización.')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
  })

  it('ante una falla del tablero muestra el error con Reintentar, que vuelve a montarlo (repite token y montaje)', async () => {
    montar()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => mocks.propsReporte.current?.alFallar?.('no_disponible'))
    expect(await screen.findByText('No pudimos cargar el tablero de Rentabilidad.')).toBeInTheDocument()
    expect(screen.queryByTestId('tablero')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByTestId('tablero')).toBeInTheDocument()
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('No pudimos cargar el tablero de Rentabilidad.')).not.toBeInTheDocument()
  })

  it('ante un 403 del token muestra el acceso restringido en lugar de la pantalla', () => {
    montar()
    act(() => mocks.propsReporte.current?.alFallar?.('prohibido'))
    expect(screen.getByText('Acceso restringido a Rentabilidad')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rentabilidad' })).not.toBeInTheDocument()
  })

  it('el botón del umbral solo existe con edición', () => {
    montar({ nivel: 'edicion' })
    expect(screen.getByRole('button', { name: 'Umbral de margen bajo' })).toBeInTheDocument()
  })

  it('Administración (solo lectura) no ve el control del umbral', () => {
    montar({ nivel: 'lectura' })
    expect(screen.queryByRole('button', { name: 'Umbral de margen bajo' })).not.toBeInTheDocument()
    expect(screen.getByTestId('tablero')).toBeInTheDocument()
  })

  it('abre el diálogo, guarda, confirma y recarga tablero y aviso', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Umbral de margen bajo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Umbral de margen bajo' })
    fireEvent.change(within(dialogo).getByRole('textbox', { name: 'Umbral de margen bajo' }), { target: { value: '15' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardar).toHaveBeenCalledWith(0.15))
    expect(await screen.findByText('Umbral de margen bajo guardado.')).toBeInTheDocument()
    expect(mocks.recargarConteo).toHaveBeenCalledTimes(1)
    expect(mocks.montajes).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Umbral de margen bajo' })).not.toBeInTheDocument())
  })

  it('Cancelar cierra el diálogo sin guardar ni recargar', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Umbral de margen bajo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Umbral de margen bajo' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Umbral de margen bajo' })).not.toBeInTheDocument())
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(mocks.recargarConteo).not.toHaveBeenCalled()
  })

  it('cambiar la empresa activa de la barra superior no recarga ni cambia el tablero (la pantalla compara todas las empresas)', () => {
    montar()
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    act(() => notificarEmpresaActivaCambiada())
    expect(screen.getByTestId('tablero')).toHaveTextContent('Tablero rep-resumen')
    expect(mocks.montajes).toHaveBeenCalledTimes(1)
    expect(mocks.recargarConteo).not.toHaveBeenCalled()
  })

  it('se puede operar con teclado: las pestañas y el botón del umbral son enfocables y hay regiones con título', () => {
    montar()
    const botonUmbral = screen.getByRole('button', { name: 'Umbral de margen bajo' })
    botonUmbral.focus()
    expect(botonUmbral).toHaveFocus()
    for (const pestana of screen.getAllByRole('tab')) {
      pestana.focus()
      expect(pestana).toHaveFocus()
    }
    expect(screen.getByRole('region', { name: 'Cómo se calcula' })).toBeInTheDocument()
  })
})
