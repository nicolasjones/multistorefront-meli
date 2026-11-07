import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      { id: 'x1', fila: 3, referencia: 'MLA-100', motivo_sanitizado: 'Precio inválido' },
      { id: 'x2', fila: null, referencia: null, motivo_sanitizado: 'La ejecución terminó con error' },
    ], 25)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    expect(within(dialogo).getByText('Importación · Mercado Libre')).toBeInTheDocument()
    expect(within(dialogo).getByText('Con errores')).toBeInTheDocument()
    const tabla = await within(dialogo).findByRole('table', { name: 'Errores del proceso' })
    for (const encabezado of ['Fila', 'Referencia', 'Motivo']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('MLA-100')).toBeInTheDocument()
    expect(within(tabla).getByText('Precio inválido')).toBeInTheDocument()
    expect(within(dialogo).getByText('Página 1 de 3')).toBeInTheDocument()
  })

  it('pagina los errores en servidor de a 10', async () => {
    responderErrores([{ id: 'x1', fila: 1, referencia: 'A', motivo_sanitizado: 'Mal' }], 25)
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalle de Carga 1' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Detalle de la importación' })
    await within(dialogo).findByRole('table', { name: 'Errores del proceso' })

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Página siguiente de errores' }))
    await waitFor(() => expect(within(dialogo).getByText('Página 2 de 3')).toBeInTheDocument())
    expect(consultasDe('procesos_masivos_errores').at(-1)?.rango).toEqual([10, 19])
    expect(consultasDe('procesos_masivos_errores').at(-1)?.filtros).toContainEqual(['proceso_id', 'p-1'])
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
