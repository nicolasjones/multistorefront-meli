import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), tipos: [] as unknown[], errorLectura: false }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        returns: async () => (mocks.errorLectura ? { data: null, error: { code: '42501' } } : { data: mocks.tipos, error: null }),
      }),
    }),
  },
}))
vi.mock('../../hooks/useListasPreciosActivas', () => ({
  useListasPreciosActivas: () => ({
    listas: [
      { id: 'l-1', nombre: 'Gremio', descripcion: null, ajustePct: -10, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' },
      { id: 'l-2', nombre: 'Revendedores', descripcion: null, ajustePct: -20, archivadaEn: null, clientesAsignados: 0, actualizadoEn: 't' },
    ],
    cargando: false,
    hayError: false,
  }),
}))

import { violacionesAxe } from '../../test/axe'
import { ListasPorTipoCliente } from './ListasPorTipoCliente'

const abrir = (props: Partial<Parameters<typeof ListasPorTipoCliente>[0]> = {}) => {
  const onCambiada = vi.fn()
  render(<ListasPorTipoCliente puedeEditar puedeAsignar onCambiada={onCambiada} {...props} />)
  return { onCambiada }
}

describe('ListasPorTipoCliente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.errorLectura = false
    mocks.tipos = [{ tipo: 'minorista', lista_precio_id: 'l-1', lista_nombre: 'Gremio', ajuste_pct: '-10', archivada_en: null }]
    mocks.rpc.mockResolvedValue({ data: null, error: null })
  })

  it('muestra la lista de cada tipo (o «Sin lista») y aclara que la propia del cliente gana', async () => {
    abrir()
    expect(await screen.findByRole('combobox', { name: 'Lista de los clientes minoristas' })).toHaveTextContent('Gremio (-10 %)')
    expect(screen.getByRole('combobox', { name: 'Lista de los clientes mayoristas' })).toHaveTextContent('Sin lista')
    expect(screen.getByText(/la lista asignada al cliente siempre gana/)).toBeInTheDocument()
  })

  it('la etiqueta queda encogida aunque el valor sea «Sin lista» (no se superpone con el texto)', async () => {
    abrir()
    const selector = await screen.findByRole('combobox', { name: 'Lista de los clientes mayoristas' })
    expect(selector).toHaveTextContent('Sin lista')
    const etiqueta = document.querySelector('label[data-shrink]')
    expect(etiqueta).not.toBeNull()
    expect(document.querySelectorAll('label[data-shrink="false"]')).toHaveLength(0)
  })

  it('cambiar la lista de un tipo llama a la función y avisa a la pantalla', async () => {
    const { onCambiada } = abrir()
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Lista de los clientes mayoristas' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Revendedores (-20 %)' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_lista_precios_tipo_cliente', { p_tipo: 'mayorista', p_lista: 'l-2' }))
    await waitFor(() => expect(onCambiada).toHaveBeenCalledTimes(1))
  })

  it('«Sin lista» quita la lista del tipo', async () => {
    abrir()
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Lista de los clientes minoristas' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Sin lista' }))
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('asignar_lista_precios_tipo_cliente', { p_tipo: 'minorista', p_lista: null }))
  })

  it('sin permiso de edición los selectores quedan deshabilitados', async () => {
    abrir({ puedeEditar: false })
    expect(await screen.findByRole('combobox', { name: 'Lista de los clientes minoristas' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('con la bandera apagada solo queda elegible la lista que ya tiene (para poder quitarla)', async () => {
    abrir({ puedeAsignar: false })
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Lista de los clientes mayoristas' }))
    const lista = await screen.findByRole('listbox')
    expect(within(lista).getByRole('option', { name: 'Sin lista' })).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(lista).getByRole('option', { name: 'Gremio (-10 %)' })).toHaveAttribute('aria-disabled', 'true')
    expect(within(lista).getByRole('option', { name: 'Revendedores (-20 %)' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('una lista archivada se ve igual, con su aviso', async () => {
    mocks.tipos = [{ tipo: 'mayorista', lista_precio_id: 'l-vieja', lista_nombre: 'Vieja', ajuste_pct: '-5', archivada_en: '2026-01-01' }]
    abrir()
    expect(await screen.findByRole('combobox', { name: 'Lista de los clientes mayoristas' })).toHaveTextContent('Vieja (-5 %)')
    expect(screen.getByText('Esta lista está archivada: no rige. Elegí otra o quitala.')).toBeInTheDocument()
  })

  it('un error de la base al cambiar se muestra en castellano', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '55000', message: 'texto interno' } })
    abrir()
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Lista de los clientes mayoristas' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Gremio (-10 %)' }))
    expect(await screen.findByText('Las listas de precios están desactivadas en este entorno.')).toBeInTheDocument()
    expect(screen.queryByText('texto interno')).not.toBeInTheDocument()
  })

  it('un error de lectura ofrece reintentar', async () => {
    mocks.errorLectura = true
    abrir()
    expect(await screen.findByText('No pudimos cargar las listas por tipo de cliente.')).toBeInTheDocument()
    mocks.errorLectura = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('combobox', { name: 'Lista de los clientes minoristas' })).toBeInTheDocument()
  })

  it.each([320, 768, 1440])('sin violaciones de axe a %i px', async (ancho) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    abrir()
    await screen.findByRole('combobox', { name: 'Lista de los clientes minoristas' })
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
