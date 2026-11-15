import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'
import { fijarAncho, ANCHOS_TIENDA } from '../../test/ancho'

// Test de INTEGRACIÓN de la pantalla (diálogo + RPC + filtros): se sube el timeout del archivo.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  useEsAdministrador: vi.fn(),
  useBanderaListasPrecios: vi.fn(),
  useListarListasPrecios: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  guardarLista: vi.fn(),
  archivarLista: vi.fn(),
  restaurarLista: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: mocks.useEsAdministrador }))
vi.mock('../../hooks/useBanderaListasPrecios', () => ({ useBanderaListasPrecios: mocks.useBanderaListasPrecios }))
vi.mock('../../hooks/useListarListasPrecios', () => ({ useListarListasPrecios: mocks.useListarListasPrecios }))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/listasPrecios', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/listasPrecios')>()),
  guardarLista: mocks.guardarLista,
  archivarLista: mocks.archivarLista,
  restaurarLista: mocks.restaurarLista,
}))

import type { ListaPrecios } from '../../lib/listasPrecios'
import { ListasPreciosList } from './listas-de-precios'

const lista = (n: number, extra: Partial<ListaPrecios> = {}): ListaPrecios => ({
  id: `l-${n}`, nombre: `Lista ${n}`, descripcion: null, ajustePct: -10 * n, archivadaEn: null, clientesAsignados: n - 1,
  actualizadoEn: `2027-03-0${n}T10:00:00.123456+00:00`, ...extra,
})

const respuesta = (listas: ListaPrecios[], extra: Record<string, unknown> = {}) => ({
  listas, total: listas.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const abrir = () => render(<ListasPreciosList />)
const ultimosFiltros = () => mocks.useListarListasPrecios.mock.calls.at(-1)![0]

describe('ListasPreciosList (F-PRE-14, RF-PRE-14-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.refetch.mockResolvedValue(undefined)
    mocks.guardarLista.mockResolvedValue('l-9')
    mocks.archivarLista.mockResolvedValue(undefined)
    mocks.restaurarLista.mockResolvedValue(undefined)
    mocks.useEsAdministrador.mockReturnValue({ esAdministrador: true, isLoading: false })
    mocks.useBanderaListasPrecios.mockReturnValue({ activa: true, cargando: false, hayError: false })
    mocks.useListarListasPrecios.mockReturnValue(respuesta([lista(1, { descripcion: 'Para revendedores' }), lista(2)]))
    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e1', isLoading: false, isError: false, refetch: vi.fn() })
  })

  it('lista nombre, ajuste con signo, clientes y estado, con el contador', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Listas de precios' })).toBeInTheDocument()
    for (const columna of ['Lista', 'Ajuste', 'Clientes', 'Estado']) {
      expect(screen.getAllByText(columna).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Lista 1')).toBeInTheDocument()
    expect(screen.getByText('Para revendedores')).toBeInTheDocument()
    expect(screen.getByText('-10 %')).toBeInTheDocument()
    expect(screen.getByText('-20 %')).toBeInTheDocument()
    expect(screen.getAllByText('Activa').length).toBeGreaterThan(0)
    expect(screen.getByText('2 listas')).toBeInTheDocument()
  })

  it('pide la primera tanda de activas y cambia de filtro reiniciando la lista', () => {
    abrir()
    expect(ultimosFiltros()).toMatchObject({ estado: 'activas', pagina: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Archivadas' }))
    expect(ultimosFiltros()).toMatchObject({ estado: 'archivadas', pagina: 1 })
  })

  it('carga infinita: con más listas en el servidor ofrece «Cargar más» y pide la tanda siguiente', () => {
    mocks.useListarListasPrecios.mockReturnValue(respuesta([lista(1), lista(2)], { total: 60 }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
    expect(ultimosFiltros()).toMatchObject({ pagina: 2 })
    expect(screen.queryByRole('navigation', { name: /paginación/i })).toBeNull()
  })

  it('«Nueva lista»: valida, guarda con el ajuste en número y recarga', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva lista' }))
    const dialogo = screen.getByRole('dialog', { name: 'Nueva lista' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Escribí el nombre de la lista.')).toBeInTheDocument()
    expect(within(dialogo).getByText('Ingresá un porcentaje entre -90 y +100, con hasta 2 decimales.')).toBeInTheDocument()
    expect(mocks.guardarLista).not.toHaveBeenCalled()

    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Revendedores' } })
    fireEvent.change(within(dialogo).getByLabelText(/Ajuste sobre el precio central/), { target: { value: '-20' } })
    expect(within(dialogo).getByText(/Ejemplo ilustrativo: un producto de \$ 10\.000 queda en \$ 8\.000/)).toBeInTheDocument()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.guardarLista).toHaveBeenCalledTimes(1))
    expect(mocks.guardarLista.mock.calls[0][1]).toMatchObject({ id: null, nombre: 'Revendedores', ajusteTexto: '-20', actualizadoEn: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Lista creada.')).toBeInTheDocument()
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('rechaza un ajuste fuera de rango o con más de 2 decimales antes de enviar', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva lista' }))
    const dialogo = screen.getByRole('dialog', { name: 'Nueva lista' })
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'X' } })
    for (const invalido of ['100,5', '-91', '12,345', 'abc']) {
      fireEvent.change(within(dialogo).getByLabelText(/Ajuste sobre el precio central/), { target: { value: invalido } })
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
      expect(await within(dialogo).findByText('Ingresá un porcentaje entre -90 y +100, con hasta 2 decimales.')).toBeInTheDocument()
    }
    expect(mocks.guardarLista).not.toHaveBeenCalled()
  })

  it('«Editar» abre con los valores y manda el updated_at tal cual para el bloqueo optimista', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Editar la lista Lista 2' }))
    const dialogo = screen.getByRole('dialog', { name: 'Editar lista' })
    expect(within(dialogo).getByLabelText(/Nombre/)).toHaveValue('Lista 2')
    expect(within(dialogo).getByLabelText(/Ajuste sobre el precio central/)).toHaveValue('-20')
    fireEvent.change(within(dialogo).getByLabelText(/Ajuste sobre el precio central/), { target: { value: '-25,5' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.guardarLista).toHaveBeenCalledTimes(1))
    expect(mocks.guardarLista.mock.calls[0][1]).toMatchObject({ id: 'l-2', ajusteTexto: '-25,5', actualizadoEn: '2027-03-02T10:00:00.123456+00:00' })
    expect(await screen.findByText('Lista actualizada.')).toBeInTheDocument()
  })

  it('muestra el error de la base en el diálogo y lo deja abierto (nombre repetido)', async () => {
    mocks.guardarLista.mockRejectedValue({ code: '23505', message: 'Ya existe una lista con ese nombre' })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva lista' }))
    const dialogo = screen.getByRole('dialog', { name: 'Nueva lista' })
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Lista 1' } })
    fireEvent.change(within(dialogo).getByLabelText(/Ajuste sobre el precio central/), { target: { value: '5' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }))
    expect(await within(dialogo).findByText('Ya existe una lista con ese nombre.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Nueva lista' })).toBeInTheDocument()
  })

  it('«Archivar» y «Restaurar» llaman a la base con el updated_at y recargan', async () => {
    mocks.useListarListasPrecios.mockReturnValue(respuesta([lista(1), lista(2, { archivadaEn: '2027-03-05T00:00:00+00:00' })]))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archivar la lista Lista 1' }))
    await waitFor(() => expect(mocks.archivarLista).toHaveBeenCalledTimes(1))
    expect(mocks.archivarLista.mock.calls[0][1]).toMatchObject({ id: 'l-1', actualizadoEn: '2027-03-01T10:00:00.123456+00:00' })
    expect(await screen.findByText('Lista archivada.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar la lista Lista 2' }))
    await waitFor(() => expect(mocks.restaurarLista).toHaveBeenCalledTimes(1))
    expect(mocks.refetch).toHaveBeenCalledTimes(2)
  })

  it('no se archiva una lista con clientes: muestra el mensaje de la base', async () => {
    mocks.archivarLista.mockRejectedValue({ code: '23503', message: 'No se puede archivar: 3 clientes usan esta lista.' })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archivar la lista Lista 2' }))
    expect(await screen.findByText('No se puede archivar: 3 clientes usan esta lista.')).toBeInTheDocument()
  })

  it('solo el administrador ve «Nueva lista», «Editar» y «Archivar»', () => {
    mocks.useEsAdministrador.mockReturnValue({ esAdministrador: false, isLoading: false })
    abrir()
    expect(screen.getByText('Lista 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva lista' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar la lista/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Archivar la lista/ })).toBeNull()
  })

  it('con la bandera apagada avisa y queda en modo solo archivar y restaurar', () => {
    mocks.useBanderaListasPrecios.mockReturnValue({ activa: false, cargando: false, hayError: false })
    abrir()
    expect(screen.getByText(/Las listas de precios están desactivadas en este entorno\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva lista' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Editar la lista/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Archivar la lista Lista 1' })).toBeInTheDocument()
  })

  it('estados compartidos: cargando, error con reintentar y vacío', () => {
    mocks.useListarListasPrecios.mockReturnValue(respuesta([], { isLoading: true }))
    const { unmount } = abrir()
    expect(screen.getByRole('status', { name: /Cargando/ })).toBeInTheDocument()
    unmount()

    mocks.useListarListasPrecios.mockReturnValue(respuesta([], { isError: true }))
    const segundo = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalled()
    segundo.unmount()

    mocks.useListarListasPrecios.mockReturnValue(respuesta([], { total: 0 }))
    abrir()
    expect(screen.getByText('Todavía no hay listas de precios.')).toBeInTheDocument()
    expect(screen.getByText('Creá la primera con «Nueva lista».')).toBeInTheDocument()
  })

  it('Empresa activa: no aplica. Cambiar la empresa con la pantalla abierta no recarga ni pierde lo escrito', () => {
    const { rerender } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Nueva lista' }))
    const dialogo = screen.getByRole('dialog', { name: 'Nueva lista' })
    fireEvent.change(within(dialogo).getByLabelText(/Nombre/), { target: { value: 'Escrito a medias' } })
    const llamadasAntes = mocks.useListarListasPrecios.mock.calls.length
    const filtrosAntes = ultimosFiltros()

    mocks.useEmpresasAccesibles.mockReturnValue({ empresas: [], empresaActivaId: 'e2', isLoading: false, isError: false, refetch: vi.fn() })
    rerender(<ListasPreciosList />)

    expect(mocks.refetch).not.toHaveBeenCalled()
    expect(ultimosFiltros()).toEqual(filtrosAntes)
    expect(mocks.useListarListasPrecios.mock.calls.length).toBeGreaterThanOrEqual(llamadasAntes)
    expect(screen.getByRole('dialog', { name: 'Nueva lista' })).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: 'Nueva lista' })).getByLabelText(/Nombre/)).toHaveValue('Escrito a medias')
  })

  it.each(ANCHOS_TIENDA)('lista y diálogo sin violaciones de axe a %i px', async (ancho) => {
    fijarAncho(ancho)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
    const { container } = abrir()
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Nueva lista' }))
    expect(await violacionesAxe(document.body)).toEqual([])
  })
})
