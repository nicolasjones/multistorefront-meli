import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configurarFiltro, consultasDe, falso, proceso, reiniciarFalso, responderProcesos } from './soporteTest'

const mocks = vi.hoisted(() => ({ puedeEscribir: vi.fn() }))

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.puedeEscribir }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

const abrir = () => render(<MemoryRouter><ImportacionesList /></MemoryRouter>)

describe('[MSF-354:T008] Centro de importaciones: tabla de procesos (FR-011, FR-016)', () => {
  beforeEach(() => {
    reiniciarFalso()
    configurarFiltro(null)
    mocks.puedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
  })

  it('muestra fecha, origen legible, estado, avance, errores y duración de cada proceso', async () => {
    responderProcesos([
      proceso(1, { funcionalidad: 'mercado-libre', estado: 'con_errores', con_errores: 3, total: 120, procesados: 120 }),
      proceso(2, { tipo: 'exportacion', funcionalidad: 'exportacion-total', estado: 'en_curso', total: 200, procesados: 50, finalizado_en: null }),
    ])
    abrir()

    const tabla = await screen.findByRole('table', { name: 'Importaciones y exportaciones' })
    for (const encabezado of ['Fecha', 'Origen', 'Estado', 'Avance', 'Resultado', 'Duración']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('Importación · Mercado Libre')).toBeInTheDocument()
    expect(within(tabla).getByText('Exportación · Exportación total')).toBeInTheDocument()
    expect(within(tabla).getByText('Con errores')).toBeInTheDocument()
    expect(within(tabla).getByText('En curso')).toBeInTheDocument()
    expect(within(tabla).getByText('120 de 120')).toBeInTheDocument()
    expect(within(tabla).getByText('50 de 200')).toBeInTheDocument()
    expect(within(tabla).getByText('1 min 30 s')).toBeInTheDocument()
  })

  it('el resultado dice «N correctas y M con error» (CA-IMP-01-1)', async () => {
    responderProcesos([
      proceso(1, { estado: 'con_errores', total: 500, procesados: 500, con_errores: 20 }),
      proceso(2, { estado: 'completado', total: 10, procesados: 10, con_errores: 0 }),
      proceso(3, { estado: 'completado', total: 1, procesados: 1, con_errores: 0 }),
    ])
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Importaciones y exportaciones' })
    expect(within(tabla).getByText('480 correctas y 20 con error')).toBeInTheDocument()
    expect(within(tabla).getByText('10 correctas y 0 con error')).toBeInTheDocument()
    expect(within(tabla).getByText('1 correcta y 0 con error')).toBeInTheDocument()
  })

  it('carga infinita: muestra el total, «Cargar más» pide la tanda siguiente y al agotarse avisa el fin', async () => {
    let cantidad = 1
    falso.respuestas.procesos_masivos = () => ({ data: Array.from({ length: cantidad }, (_, i) => proceso(i + 1)), count: 2, error: null })
    abrir()
    expect(await screen.findByText('Mostrando 1 de 2 procesos')).toBeInTheDocument()
    expect(screen.queryByText(/Página \d+ de/)).not.toBeInTheDocument()
    expect(consultasDe('procesos_masivos')[0].rango).toEqual([0, 19])

    cantidad = 2
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(await screen.findByText('Mostrando 2 de 2 procesos')).toBeInTheDocument()
    expect(consultasDe('procesos_masivos').at(-1)?.rango).toEqual([0, 39])
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
    expect(screen.getByText('No hay más resultados.')).toBeInTheDocument()
  })

  it('no muestra la clave técnica de la funcionalidad ni identificadores', async () => {
    responderProcesos([proceso(1, { funcionalidad: 'carga-especial_x' })])
    abrir()
    expect(await screen.findByText('Importación · Carga especial x')).toBeInTheDocument()
    expect(screen.queryByText(/carga-especial_x/)).not.toBeInTheDocument()
    expect(screen.queryByText('p-1')).not.toBeInTheDocument()
  })

  it('muestra el estado de carga, mientras espera la primera respuesta', () => {
    responderProcesos([proceso(1)])
    abrir()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('muestra el estado vacío cuando no hay procesos', async () => {
    responderProcesos([])
    abrir()
    expect(await screen.findByText('Todavía no hay importaciones ni exportaciones.')).toBeInTheDocument()
  })

  it('muestra el error con «Reintentar» y recarga', async () => {
    responderProcesos(new Error('falló'))
    abrir()
    expect(await screen.findByText('No pudimos cargar las importaciones y exportaciones.')).toBeInTheDocument()
    responderProcesos([proceso(1)])
    screen.getByRole('button', { name: 'Reintentar' }).click()
    expect(await screen.findByRole('table', { name: 'Importaciones y exportaciones' })).toBeInTheDocument()
    expect(consultasDe('procesos_masivos')).toHaveLength(2)
  })

  it('una persona que no es administradora no consulta nada', () => {
    mocks.puedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()
    expect(screen.getByText(/Solo un administrador de la organización/)).toBeInTheDocument()
    expect(consultasDe('procesos_masivos')).toHaveLength(0)
  })
})
