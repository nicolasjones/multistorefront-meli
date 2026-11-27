import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), bandera: { activa: true, cargando: false, hayError: false } }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../hooks/useBanderaListasPrecios', () => ({ useBanderaListasPrecios: () => mocks.bandera }))
vi.mock('../../hooks/useListasPreciosActivas', () => ({
  useListasPreciosActivas: () => ({
    listas: [
      { id: 'l-1', nombre: 'Revendedores', descripcion: null, ajustePct: -20, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' },
      { id: 'l-2', nombre: 'Recargo', descripcion: null, ajustePct: 25, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' },
    ],
    cargando: false,
    hayError: false,
  }),
}))

import { violacionesAxe } from '../../test/axe'
import { DialogoAsignarListaMasiva } from './DialogoAsignarListaMasiva'

const FILTRO = { texto: 'norte', tipo: 'mayorista' as const, empresaId: 'e-1', conCuentaWeb: false }

const abrir = (props: Partial<Parameters<typeof DialogoAsignarListaMasiva>[0]> = {}) => {
  const onAsignado = vi.fn()
  const onCerrar = vi.fn()
  render(
    <DialogoAsignarListaMasiva
      open seleccion={['c-1', 'c-2']} filtro={FILTRO} totalFiltro={40} mostrandoArchivados={false}
      onCerrar={onCerrar} onAsignado={onAsignado} {...props}
    />,
  )
  return { onAsignado, onCerrar }
}

const elegirLista = async (nombre: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lista de precios' }))
  fireEvent.click(await screen.findByRole('option', { name: nombre }))
}

describe('DialogoAsignarListaMasiva', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.bandera.activa = true
    mocks.bandera.cargando = false
    mocks.bandera.hayError = false
    mocks.rpc.mockResolvedValue({ data: [{ asignados: 2, sin_cambios: 0, omitidos: 0 }], error: null })
  })

  it('asigna la lista elegida a los clientes marcados', async () => {
    const { onAsignado } = abrir()
    expect(screen.getByRole('radio', { name: 'Los clientes marcados (2)' })).toBeChecked()
    await elegirLista('Revendedores (-20 %)')
    fireEvent.click(screen.getByRole('button', { name: 'Asignar a 2' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_lista_precios_masiva', {
      p_lista: 'l-1', p_clientes: ['c-1', 'c-2'], p_texto: null, p_tipo: null, p_empresa_id: null, p_con_cuenta_web: false,
    }))
    await waitFor(() => expect(onAsignado).toHaveBeenCalledWith({ asignados: 2, sinCambios: 0, omitidos: 0 }, 'Revendedores'))
  })

  it('por filtro envía los criterios del listado y la cantidad es el total que coincide', async () => {
    abrir()
    fireEvent.click(screen.getByRole('radio', { name: 'Todos los que coinciden con la búsqueda y los filtros (40)' }))
    await elegirLista('Recargo (+25 %)')
    fireEvent.click(screen.getByRole('button', { name: 'Asignar a 40' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_lista_precios_masiva', {
      p_lista: 'l-2', p_clientes: null, p_texto: 'norte', p_tipo: 'mayorista', p_empresa_id: 'e-1', p_con_cuenta_web: false,
    }))
  })

  it('sin marcados parte del filtro y la opción de marcados queda deshabilitada', () => {
    abrir({ seleccion: [] })
    expect(screen.getByRole('radio', { name: 'Los clientes marcados (0)' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Todos los que coinciden con la búsqueda y los filtros (40)' })).toBeChecked()
  })

  it('con archivados a la vista solo se alcanzan los marcados', () => {
    abrir({ mostrandoArchivados: true })
    expect(screen.getByRole('radio', { name: 'Todos los que coinciden con la búsqueda y los filtros (40)' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Los clientes marcados (2)' })).toBeChecked()
    expect(screen.getByText(/Los clientes archivados no admiten lista de precios/)).toBeInTheDocument()
  })

  it('«Quitar la lista de precios» envía p_lista nulo', async () => {
    abrir()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lista de precios' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Quitar la lista de precios' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a 2' }))
    await waitFor(() => expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_lista: null, p_clientes: ['c-1', 'c-2'] }))
  })

  it('con la bandera apagada solo se puede quitar la lista y se explica', async () => {
    mocks.bandera.activa = false
    abrir()
    expect(screen.getByText(/Las listas de precios están desactivadas en este entorno\. Por ahora solo podés quitar la lista\./)).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Lista de precios' }))
    const opciones = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent)
    expect(opciones).toEqual(['Quitar la lista de precios'])
  })

  it('sin elegir lista el botón está deshabilitado', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Asignar a 2' })).toBeDisabled()
  })

  it.each([[5000, false], [5001, true]])('con %i clientes el aviso de tope aparece: %s', (total, aviso) => {
    abrir({ seleccion: [], totalFiltro: total })
    expect(screen.queryByText(/Son más de 5000 clientes/) !== null).toBe(aviso)
  })

  it('un error de la base se muestra en castellano y el diálogo sigue abierto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'texto interno' } })
    const { onAsignado } = abrir()
    await elegirLista('Revendedores (-20 %)')
    fireEvent.click(screen.getByRole('button', { name: 'Asignar a 2' }))
    expect(await screen.findByText('Solo un administrador puede cambiar las listas de precios.')).toBeInTheDocument()
    expect(screen.queryByText('texto interno')).not.toBeInTheDocument()
    expect(onAsignado).not.toHaveBeenCalled()
  })

  it('cancelar cierra sin llamar a la base', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrir()
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
