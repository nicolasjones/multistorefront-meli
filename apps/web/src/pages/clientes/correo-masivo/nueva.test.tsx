import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useDestinatarios: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
  elegirEmpresa: vi.fn(),
  refetch: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

vi.mock('../../../hooks/useDestinatariosCorreoMasivo', () => ({ useDestinatariosCorreoMasivo: mocks.useDestinatarios }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { CorreoMasivoNueva } from './nueva'

const filaDestinatario = (n: number) => ({ id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, correo: `c${n}@example.com` })
const respuesta = (filas = [filaDestinatario(1), filaDestinatario(2)], extra: Record<string, unknown> = {}) => ({
  filas, total: filas.length, resumen: { elegibles: filas.length, sin_correo: 3, no_aceptan: 1 },
  isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})
const ultimosFiltros = () => mocks.useDestinatarios.mock.calls.at(-1)![0]
const abrir = (state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/clientes/correo-masivo', state }]}><CorreoMasivoNueva /></MemoryRouter>,
)

describe('Correo masivo · Nueva campaña', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocks.rpc.mockResolvedValue({ data: 'campana-1', error: null })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useDestinatarios.mockReturnValue(respuesta())
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }],
      valor: null, cambiar: mocks.elegirEmpresa, empresaActivaId: null, cargando: false, hayError: false,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('lista los destinatarios con su conteo y dice cuántos quedan afuera y por qué', () => {
    abrir()
    expect(screen.getByRole('heading', { name: 'Correo masivo' })).toBeInTheDocument()
    expect(screen.getAllByText('Cliente 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('c2@example.com').length).toBeGreaterThan(0)
    expect(screen.getByText('2 destinatarios')).toBeInTheDocument()
    expect(screen.getByText('Quedan afuera: 3 sin correo y 1 no acepta el correo masivo.')).toBeInTheDocument()
  })

  it('FR-003: la búsqueda, el tipo, la empresa y «con cuenta web» recalculan lista y conteo', () => {
    abrir()
    expect(ultimosFiltros()).toMatchObject({ texto: '', tipo: null, empresaId: null, conCuentaWeb: false, clientes: null, pagina: 1 })

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar clientes' }), { target: { value: 'ana' } })
    act(() => { vi.advanceTimersByTime(350) })
    expect(ultimosFiltros()).toMatchObject({ texto: 'ana' })

    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    expect(ultimosFiltros()).toMatchObject({ tipo: 'mayorista' })

    fireEvent.click(screen.getByRole('button', { name: 'Con cuenta web' }))
    expect(ultimosFiltros()).toMatchObject({ conCuentaWeb: true })

    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    expect(mocks.elegirEmpresa).toHaveBeenCalledWith('e-2')
  })

  it('usa FiltroEmpresa: «Todas las tiendas» y una píldora por empresa', () => {
    abrir()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'San Javucho' })).toBeInTheDocument()
  })

  it('con clientes marcados en el listado restringe el grupo a ellos y permite quitar la selección', () => {
    abrir({ clientes: ['c-1', 'c-9'], empresaActivaId: null })
    expect(ultimosFiltros()).toMatchObject({ clientes: ['c-1', 'c-9'] })
    expect(screen.getByText('Solo los 2 clientes marcados en el listado.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar selección' }))
    expect(ultimosFiltros()).toMatchObject({ clientes: null })
    expect(screen.queryByText(/clientes marcados en el listado/)).not.toBeInTheDocument()
  })

  it('sin destinatarios muestra el estado vacío; con error, el reintento', () => {
    mocks.useDestinatarios.mockReturnValue(respuesta([]))
    const { unmount } = abrir()
    expect(screen.getByText('Todavía no hay clientes que acepten el correo masivo.')).toBeInTheDocument()
    unmount()

    mocks.useDestinatarios.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    expect(screen.getByText('No pudimos cargar los destinatarios.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('mientras carga muestra el estado de carga y no la lista', () => {
    mocks.useDestinatarios.mockReturnValue(respuesta([filaDestinatario(1)], { isLoading: true }))
    abrir()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
  })

  it('FR-006: sin edición en Clientes no se puede armar el grupo', () => {
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false })
    abrir()
    expect(screen.getByText('Tu rol no puede armar el correo masivo.')).toBeInTheDocument()
    expect(screen.queryByText('Cliente 1')).not.toBeInTheDocument()
  })
})

// F-CLI-12: redactar y enviar (FR-010, FR-015).
describe('Correo masivo · Nueva campaña · redactar y enviar', () => {
  const redactar = (asunto: string, mensaje: string) => {
    fireEvent.change(screen.getByLabelText(/Asunto/), { target: { value: asunto } })
    fireEvent.change(screen.getByLabelText(/Mensaje/), { target: { value: mensaje } })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue({ data: 'campana-1', error: null })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.useDestinatarios.mockReturnValue(respuesta())
    mocks.useFiltroPorEmpresaActiva.mockReturnValue({
      empresas: [{ id: 'e-1', nombre: 'San Javucho' }], valor: 'e-1', cambiar: mocks.elegirEmpresa, empresaActivaId: 'e-1', cargando: false, hayError: false,
    })
  })

  it('FR-010: Asunto y Mensaje son obligatorios: sin ellos no se abre la confirmación ni se envía', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByText('El asunto es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('El mensaje es obligatorio.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('FR-010: respeta los máximos de 200 y 10 000 caracteres', async () => {
    abrir()
    redactar('a'.repeat(201), 'b'.repeat(10001))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    expect(await screen.findByText('El asunto admite hasta 200 caracteres.')).toBeInTheDocument()
    expect(screen.getByText('El mensaje admite hasta 10000 caracteres.')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('FR-010: el mensaje es texto, sin HTML: la etiqueta se envía tal cual y la vista previa no la interpreta', async () => {
    abrir()
    redactar('Asunto', '<b>Hola</b>')
    expect(screen.getByTestId('vista-previa-mensaje').querySelector('b')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await screen.findByRole('dialog', { name: 'Enviar correo' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Enviar correo' }).at(-1)!)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled())
    expect(mocks.rpc.mock.calls[0][1].p_mensaje).toBe('<b>Hola</b>')
  })

  it('FR-015: confirma, crea la campaña con los filtros de la pantalla y la empresa activa, y avisa el resultado', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    redactar('Ofertas', 'Hola')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Enviar correo' })
    expect(dialogo).toHaveTextContent('Se envía a 2 destinatarios')
    expect(mocks.rpc).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Enviar correo' }).at(-1)!)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1))
    expect(mocks.rpc).toHaveBeenCalledWith('crear_campana_correo', {
      p_clave: expect.stringMatching(/^[0-9a-f-]{36}$/), p_asunto: 'Ofertas', p_mensaje: 'Hola', p_empresa: 'e-1',
      p_texto: null, p_tipo: 'mayorista', p_con_cuenta_web: false, p_clientes: null,
    })
    expect(await screen.findByText(/Campaña creada: el correo se envía en lotes a 2 clientes/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Asunto/)).toHaveValue('')
  })

  it('«Cancelar» en la confirmación no crea nada', async () => {
    abrir()
    redactar('Ofertas', 'Hola')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('un rechazo de la base se explica en la confirmación y se puede reintentar con la misma clave', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', hint: 'sin_destinatarios', message: 'x' } })
    abrir()
    redactar('Ofertas', 'Hola')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar correo' }))
    await screen.findByRole('dialog', { name: 'Enviar correo' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Enviar correo' }).at(-1)!)
    expect(await screen.findByText(/No hay clientes elegibles/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Enviar correo' }).at(-1)!)
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    expect(mocks.rpc.mock.calls[0][1].p_clave).toBe(mocks.rpc.mock.calls[1][1].p_clave)
  })

  it('sin destinatarios elegibles no se ofrece enviar', () => {
    mocks.useDestinatarios.mockReturnValue(respuesta([], { resumen: { elegibles: 0, sin_correo: 2, no_aceptan: 1 } }))
    abrir()
    expect(screen.getByRole('button', { name: 'Enviar correo' })).toBeDisabled()
    expect(screen.getByText('No hay destinatarios para enviar con estos criterios.')).toBeInTheDocument()
  })
})
