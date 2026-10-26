import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listar: vi.fn(),
  avisar: vi.fn(),
  useNivelSeccion: vi.fn(),
  useFiltroPorEmpresaActiva: vi.fn(),
}))

vi.mock('../../lib/faltantes', async (original) => ({
  ...(await original<typeof import('../../lib/faltantes')>()),
  listarFaltantes: mocks.listar,
  avisarFaltantes: mocks.avisar,
}))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.useFiltroPorEmpresaActiva }))
vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { FaltantesStock } from './faltantes'

const fila = (n: number, empresaId: string, empresa: string) => ({
  linea_id: `l-${n}`,
  empresa_id: empresaId,
  empresa,
  cliente_id: `c-${n}`,
  cliente: `Cliente ${n}`,
  producto: `Producto ${n}`,
  sku: `SKU-${n}`,
  pedido: n,
  comprobante_id: `f-${n}`,
  comprobante_numero: `A-000${n}`,
  desde: '2026-10-05',
  estado_stock: 'disponible',
  aviso: 'sin_avisar',
})

const TODAS = [fila(1, 'e-1', 'San Javucho'), fila(2, 'e-2', 'Mundo JC')]
const empresas = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

const estadoFiltro = { empresaActivaId: null as string | null }
// Total forzado para simular varias páginas (0 = el total real, una sola página).
const estadoListado = { total: 0 }

const abrir = () => render(<MemoryRouter><FaltantesStock /></MemoryRouter>)
const reabrir = (rerender: ReturnType<typeof render>['rerender']) => rerender(<MemoryRouter><FaltantesStock /></MemoryRouter>)
const abrirEstricto = () => render(<StrictMode><MemoryRouter><FaltantesStock /></MemoryRouter></StrictMode>)
const reabrirEstricto = (rerender: ReturnType<typeof render>['rerender']) =>
  rerender(<StrictMode><MemoryRouter><FaltantesStock /></MemoryRouter></StrictMode>)
const ultimosFiltros = () => mocks.listar.mock.calls.at(-1)![0]
const pedidosDe = (empresaId: string) => mocks.listar.mock.calls.filter(([filtros]) => filtros.empresaId === empresaId)

describe('FaltantesStock · empresa activa (F-STK-17, FR-304, FR-311, SC-303)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    estadoFiltro.empresaActivaId = null
    estadoListado.total = 0
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false })
    mocks.listar.mockImplementation(async ({ empresaId }: { empresaId: string | null }) => {
      const filas = TODAS.filter((f) => !empresaId || f.empresa_id === empresaId)
      return { filas, total: estadoListado.total || filas.length }
    })
    mocks.avisar.mockResolvedValue({
      encolados: 1, lineas_avisadas: 1, omitidos_ya_avisados: 0, omitidos_sin_stock: 0, omitidos_sin_correo: 0, omitidos_sin_permiso: 0,
    })
    // Igual que el hook real: la empresa activa manda y el filtro de la pantalla la sobreescribe hasta que cambie.
    mocks.useFiltroPorEmpresaActiva.mockImplementation(() => {
      const [sobrescritura, setSobrescritura] = useState<{ base: string | null; valor: string | null } | null>(null)
      const valor = sobrescritura && sobrescritura.base === estadoFiltro.empresaActivaId
        ? sobrescritura.valor
        : estadoFiltro.empresaActivaId
      return {
        empresas,
        valor,
        cambiar: (id: string | null) => setSobrescritura({ base: estadoFiltro.empresaActivaId, valor: id }),
        empresaActivaId: estadoFiltro.empresaActivaId,
        cargando: false,
        hayError: false,
      }
    })
  })

  it('con «Todas las tiendas» lista todo; elegir una tienda en el filtro recarga acotada a ella', async () => {
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
    expect(ultimosFiltros()).toMatchObject({ empresaId: null })
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 }))
    await waitFor(() => expect(screen.queryByText('Producto 1')).not.toBeInTheDocument())
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
  })

  it('con una empresa concreta en la barra superior filtra por ella', async () => {
    estadoFiltro.empresaActivaId = 'e-1'
    abrir()
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.queryByText('Producto 2')).not.toBeInTheDocument()
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-1' })
  })

  it('cambiar la empresa activa recarga, vuelve a la página 1, descarta la selección y nunca deja filas de la anterior', async () => {
    estadoFiltro.empresaActivaId = 'e-1'
    const { rerender } = abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001'))
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)' })).toBeEnabled()

    // La respuesta de la nueva empresa tarda: mientras tanto no puede verse la lista de la anterior.
    let resolver: (valor: unknown) => void = () => undefined
    mocks.listar.mockImplementationOnce(() => new Promise((resuelto) => { resolver = resuelto }))
    estadoFiltro.empresaActivaId = 'e-2'
    reabrir(rerender)
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
    expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 })

    resolver({ filas: [TODAS[1]], total: 1 })
    expect(await screen.findByText('Producto 2')).toBeInTheDocument()
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
  })

  it('cambiar la empresa con el diálogo abierto lo cierra con aviso y no envía nada', async () => {
    estadoFiltro.empresaActivaId = 'e-1'
    const { rerender } = abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001'))
    fireEvent.click(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)' }))
    expect(await screen.findByRole('dialog', { name: 'Avisar a los clientes' })).toBeInTheDocument()

    estadoFiltro.empresaActivaId = 'e-2'
    reabrir(rerender)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Cambiaste de empresa: se cerró el aviso a los clientes.')).toBeInTheDocument()
    expect(mocks.avisar).not.toHaveBeenCalled()
  })

  it('cambiar la empresa activa reencuadra la paginación a la primera y consulta la nueva empresa una sola vez', async () => {
    estadoListado.total = 60 // tres páginas de 25
    estadoFiltro.empresaActivaId = 'e-1'
    const { rerender } = abrir()
    await screen.findByText('Producto 1')

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-1', pagina: 2 }))
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-1', pagina: 3 }))
    expect(screen.getByText('51–60 de 60')).toBeInTheDocument()

    estadoFiltro.empresaActivaId = 'e-2'
    reabrir(rerender)

    // La paginación vuelve a la primera y la consulta sale en la página 1 (no se pide una página vieja).
    await waitFor(() => expect(ultimosFiltros()).toMatchObject({ empresaId: 'e-2', pagina: 1 }))
    expect(screen.getByText('1–25 de 60')).toBeInTheDocument()
    expect(pedidosDe('e-2')).toHaveLength(1)
  })

  it('una respuesta tardía de la empresa anterior no pisa la lista nueva', async () => {
    estadoFiltro.empresaActivaId = 'e-1'
    let resolverViejo: (valor: unknown) => void = () => undefined
    mocks.listar.mockImplementationOnce(() => new Promise((resuelto) => { resolverViejo = resuelto }))
    const { rerender } = abrir()

    estadoFiltro.empresaActivaId = 'e-2'
    reabrir(rerender)
    expect(await screen.findByText('Producto 2')).toBeInTheDocument()

    // Llega tarde la respuesta de la empresa anterior: no puede volver a la pantalla.
    resolverViejo({ filas: [TODAS[0]], total: 1 })
    await waitFor(() => expect(mocks.listar).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
    expect(screen.getByText('Producto 2')).toBeInTheDocument()
  })

  it('al volver a la empresa anterior la selección no se re-arma sola', async () => {
    estadoFiltro.empresaActivaId = 'e-1'
    const { rerender } = abrir()
    await screen.findByText('Producto 1')
    fireEvent.click(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001'))
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (1)' })).toBeEnabled()

    estadoFiltro.empresaActivaId = 'e-2'
    reabrir(rerender)
    expect(await screen.findByText('Producto 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()

    estadoFiltro.empresaActivaId = 'e-1'
    reabrir(rerender)
    expect(await screen.findByText('Producto 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisar a los seleccionados (0)' })).toBeDisabled()
    expect(screen.getByLabelText('Seleccionar Producto 1 de Cliente 1 del comprobante A-0001')).not.toBeChecked()
  })

  it('el reencuadre aguanta el doble montaje de StrictMode: sin bucle, sin errores y una sola consulta', async () => {
    estadoFiltro.empresaActivaId = 'e-1'
    const errores: unknown[][] = []
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args) => { errores.push(args) })
    try {
      const { rerender } = abrirEstricto()
      expect(await screen.findByText('Producto 1')).toBeInTheDocument()

      estadoFiltro.empresaActivaId = 'e-2'
      reabrirEstricto(rerender)
      expect(await screen.findByText('Producto 2')).toBeInTheDocument()
      expect(screen.queryByText('Producto 1')).not.toBeInTheDocument()
      await waitFor(() => expect(pedidosDe('e-2')).toHaveLength(1))
    } finally {
      consoleSpy.mockRestore()
    }
    expect(errores).toEqual([])
  })
})
