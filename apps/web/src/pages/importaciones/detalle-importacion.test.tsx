import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as exportarCsv from '../../lib/exportarCsv'
import { configurarFiltro, consultasDe, falso, proceso, reiniciarFalso, responderErrores, responderProcesos } from './soporteTest'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: true, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

const abrir = () => render(<MemoryRouter><ImportacionesList /></MemoryRouter>)

describe('[MSF-354:T010] Diálogo «Detalle de la importación» (FR-013)', () => {
  beforeEach(() => {
    reiniciarFalso()
    configurarFiltro(null)
    responderProcesos([proceso(1, { estado: 'con_errores', con_errores: 25, funcionalidad: 'mercado-libre' })])
  })

  it('«Ver detalle» abre el resumen y los errores con fila, referencia y motivo', async () => {
    responderErrores([
      { id: 'x1', fila: 3, columna: 'precio', referencia: 'MLA-100', motivo_sanitizado: 'Precio inválido' },
      { id: 'x2', fila: null, columna: null, referencia: null, motivo_sanitizado: 'La ejecución terminó con error' },
    ], 25)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    expect(within(dialogo).getByText('Importación · Mercado Libre')).toBeInTheDocument()
    expect(within(dialogo).getByText('Con errores')).toBeInTheDocument()
    const tabla = await within(dialogo).findByRole('table', { name: 'Errores del proceso' })
    for (const encabezado of ['Fila', 'Columna', 'Referencia', 'Motivo']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('MLA-100')).toBeInTheDocument()
    expect(within(tabla).getByText('precio')).toBeInTheDocument()
    expect(within(tabla).getByText('Precio inválido')).toBeInTheDocument()
    expect(within(dialogo).getByText('Mostrando 2 de 25 errores')).toBeInTheDocument()
    expect(within(dialogo).getByText('75 correctas y 25 con error')).toBeInTheDocument()
  })

  it('carga infinita: «Cargar más» suma la tanda siguiente sin perder el total', async () => {
    responderErrores([{ id: 'x1', fila: 1, columna: 'sku', referencia: 'A', motivo_sanitizado: 'Mal' }], 25)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    await within(dialogo).findByRole('table', { name: 'Errores del proceso' })
    expect(consultasDe('procesos_masivos_errores').at(-1)?.rango).toEqual([0, 19])
    expect(within(dialogo).queryByText(/Página \d+ de/)).not.toBeInTheDocument()

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cargar más' }))
    await waitFor(() => expect(consultasDe('procesos_masivos_errores').at(-1)?.rango).toEqual([0, 39]))
    expect(consultasDe('procesos_masivos_errores').at(-1)?.filtros).toContainEqual(['proceso_id', 'p-1'])
    expect(within(dialogo).getByText('Errores (25)')).toBeInTheDocument()
  })

  it('«Descargar errores (CSV)» baja TODOS los errores del proceso, con BOM y fórmulas neutralizadas', async () => {
    const todos = Array.from({ length: 1200 }, (_, i) => ({
      id: `x${i}`, fila: i + 1, columna: i === 0 ? 'precio' : null, referencia: i === 0 ? '=HYPERLINK("x")' : null,
      motivo_sanitizado: i === 0 ? '+cmd|calc; "raro"' : `Motivo ${i}`,
    }))
    falso.respuestas.procesos_masivos_errores = (llamada) => {
      const [desde, hasta] = llamada.rango ?? [0, 19]
      return { data: todos.slice(desde, hasta + 1), count: todos.length, error: null }
    }
    const descargar = vi.spyOn(exportarCsv, 'descargarCsv').mockImplementation(() => undefined)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    fireEvent.click(await within(dialogo).findByRole('button', { name: 'Descargar errores (CSV)' }))

    await waitFor(() => expect(descargar).toHaveBeenCalledTimes(1))
    const [contenido, nombre] = descargar.mock.calls[0]
    expect(nombre).toMatch(/^errores-carga-1-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(contenido.startsWith('﻿')).toBe(true)
    const lineas = contenido.slice(1).split('\r\n').filter(Boolean)
    expect(lineas[0]).toBe('Fila;Columna;Referencia;Motivo')
    expect(lineas).toHaveLength(1201)
    expect(lineas[1]).toBe('1;precio;"\'=HYPERLINK(""x"")";"\'+cmd|calc; ""raro"""')
    expect(lineas[1200]).toBe('1200;;;Motivo 1199')
    descargar.mockRestore()
  })

  it('si falla la descarga no baja ningún archivo y lo avisa', async () => {
    responderErrores([{ id: 'x1', fila: 1, columna: null, referencia: null, motivo_sanitizado: 'Mal' }], 1)
    const descargar = vi.spyOn(exportarCsv, 'descargarCsv').mockImplementation(() => undefined)
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    const boton = await within(dialogo).findByRole('button', { name: 'Descargar errores (CSV)' })
    falso.respuestas.procesos_masivos_errores = () => ({ data: null, count: null, error: { message: 'falló' } })
    fireEvent.click(boton)
    expect(await within(dialogo).findByText(/No pudimos exportar/)).toBeInTheDocument()
    expect(descargar).not.toHaveBeenCalled()
    descargar.mockRestore()
    consola.mockRestore()
  })

  it('un proceso sin errores lo dice', async () => {
    responderErrores([])
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))
    expect(await screen.findByText('Este proceso no registró errores.')).toBeInTheDocument()
  })

  it('«Cerrar» cierra el diálogo', async () => {
    responderErrores([])
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
