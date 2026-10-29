import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  filtro: vi.fn(),
}))

vi.mock('../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: null, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: mocks.filtro }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { ActividadList } from './list'

const EMPRESAS = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

// Replica el hook real (sigue la activa; el select la sobreescribe hasta que la
// activa cambie) con estado, para poder elegir en el select.
function mockFiltro({ empresaActivaId = null }: { empresaActivaId?: string | null } = {}) {
  mocks.filtro.mockImplementation(() => {
    const [sobreescritura, setSobreescritura] = useState<{ base: string | null; valor: string | null } | null>(null)
    const valor = sobreescritura && sobreescritura.base === empresaActivaId ? sobreescritura.valor : empresaActivaId
    return {
      empresas: EMPRESAS,
      valor,
      cambiar: (id: string | null) => setSobreescritura({ base: empresaActivaId, valor: id }),
      empresaActivaId,
      cargando: false,
      hayError: false,
    }
  })
}

const fila = (n: number, sobre: Record<string, unknown> = {}) => ({
  id: `ev-${n}`,
  creado_en: '2026-10-01T03:30:00Z',
  tipo: 'empresa.pausada',
  empresa_id: 'e-1',
  empresa_nombre: 'San Javucho',
  actor_id: 'u-1',
  actor_nombre: 'Ana Admin',
  detalle: `Detalle ${n}`,
  total: 25,
  ...sobre,
})

const OPCIONES = {
  tipos: ['empresa.pausada', 'usuario.rol_cambiado'],
  actores: [{ id: 'u-1', nombre: 'Ana Admin' }, { id: 'u-2', nombre: 'Omar Operador' }],
}

// listar_actividad responde `filas`; opciones_actividad, OPCIONES.
function responder(filas: unknown[] | Error) {
  mocks.rpc.mockImplementation((nombre: string) => {
    if (nombre === 'opciones_actividad') return Promise.resolve({ data: OPCIONES, error: null })
    return filas instanceof Error
      ? Promise.resolve({ data: null, error: { message: filas.message } })
      : Promise.resolve({ data: filas, error: null })
  })
}

const llamadasAListar = () => mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'listar_actividad')
const ultimaLlamada = () => llamadasAListar().at(-1)![1] as Record<string, unknown>

const abrir = () => render(<MemoryRouter><ActividadList /></MemoryRouter>)

async function elegir(etiqueta: string, opcion: string) {
  const combo = screen.queryByRole('combobox', { name: etiqueta })
  if (combo) {
    fireEvent.mouseDown(combo)
    fireEvent.click(await screen.findByRole('option', { name: opcion }))
    return
  }
  const grupo = screen.getByRole('group', { name: 'Filtrar por tienda' })
  fireEvent.click(within(grupo).getByRole('button', { name: opcion }))
}

describe('ActividadList (F-AUD-01, SC-001)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mockFiltro()
  })

  it('lista Cuándo, Tipo, Tienda, Detalle y Quién en hora de Buenos Aires, sin identificadores', async () => {
    responder([fila(1)])
    abrir()

    const tabla = await screen.findByRole('table', { name: 'Actividad' })
    for (const encabezado of ['Cuándo', 'Tipo', 'Tienda', 'Detalle', 'Quién']) {
      expect(within(tabla).getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('01/10/2026 00:30')).toBeInTheDocument()
    expect(within(tabla).getByText('Empresa pausada')).toBeInTheDocument()
    expect(within(tabla).getByText('San Javucho')).toBeInTheDocument()
    expect(within(tabla).getByText('Ana Admin')).toBeInTheDocument()
    expect(screen.queryByText(/ev-1|u-1/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exportar/i })).not.toBeInTheDocument()
  })

  it('muestra «Compartido» sin empresa y «Sistema» sin actor', async () => {
    responder([fila(1, { empresa_id: null, empresa_nombre: null, actor_id: null, actor_nombre: null })])
    abrir()

    expect(await screen.findByText('Compartido')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
  })

  it('el operador ve todo: pide el listado sin acotar por usuario ni tipo', async () => {
    responder([fila(1)])
    abrir()
    await screen.findByRole('table', { name: 'Actividad' })

    expect(ultimaLlamada()).toMatchObject({ p_empresa: null, p_actor: null, p_tipo: null, p_texto: null, p_pagina: 1, p_tamano: 10 })
  })

  it('sigue la empresa activa de la barra superior como filtro de tienda', async () => {
    responder([fila(1)])
    mockFiltro({ empresaActivaId: 'e-2' })
    abrir()
    await screen.findByRole('table', { name: 'Actividad' })

    await waitFor(() => expect(ultimaLlamada()).toMatchObject({ p_empresa: 'e-2' }))
    expect(screen.getByRole('button', { name: 'Mundo JC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('combina período, empresa, usuario y tipo, y vuelve a la página 1', async () => {
    responder([fila(1)])
    abrir()
    await screen.findByRole('table', { name: 'Actividad' })

    await elegir('Tienda', 'Mundo JC')
    await elegir('Usuario', 'Omar Operador')
    await elegir('Tipo', 'Cambio de rol')
    await elegir('Período', 'Todo el historial')

    await waitFor(() =>
      expect(ultimaLlamada()).toMatchObject({
        p_desde: null,
        p_hasta: null,
        p_empresa: 'e-2',
        p_actor: 'u-2',
        p_tipo: 'usuario.rol_cambiado',
        p_pagina: 1,
      }),
    )
  })

  it('el período por defecto son los últimos 7 días en fechas de Buenos Aires', async () => {
    responder([fila(1)])
    abrir()
    await screen.findByRole('table', { name: 'Actividad' })

    const { p_desde, p_hasta } = ultimaLlamada()
    expect(p_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(p_hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${p_hasta}T00:00:00Z`).getTime() - new Date(`${p_desde}T00:00:00Z`).getTime()).toBe(6 * 24 * 3600 * 1000)
  })

  it('busca por texto después de una pausa y combinada con los demás filtros', async () => {
    responder([fila(1)])
    abrir()
    await screen.findByRole('table', { name: 'Actividad' })
    await elegir('Tienda', 'Mundo JC')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en la actividad' }), { target: { value: ' lámpara ' } })

    await waitFor(() => expect(ultimaLlamada()).toMatchObject({ p_texto: 'lámpara', p_empresa: 'e-2' }))
  })

  it('pagina en servidor y muestra el rango «1–10 de N»', async () => {
    responder(Array.from({ length: 10 }, (_, i) => fila(i + 1)))
    abrir()

    expect(await screen.findByText('1–10 de 25')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()

    responder(Array.from({ length: 10 }, (_, i) => fila(i + 11)))
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    expect(await screen.findByText('11–20 de 25')).toBeInTheDocument()
    expect(ultimaLlamada()).toMatchObject({ p_pagina: 2 })

    responder(Array.from({ length: 5 }, (_, i) => fila(i + 21)))
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    expect(await screen.findByText('21–25 de 25')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled()
  })

  it('muestra el estado de carga mientras consulta', () => {
    mocks.rpc.mockReturnValue(new Promise(() => {}))
    abrir()

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('muestra el estado vacío sin resultados', async () => {
    responder([])
    abrir()

    expect(await screen.findByText('Todavía no hay actividad registrada.')).toBeInTheDocument()
  })

  it('con un filtro activo y sin resultados avisa que es por los filtros', async () => {
    responder([])
    abrir()
    await screen.findByText('Todavía no hay actividad registrada.')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar en la actividad' }), { target: { value: 'zzz' } })

    expect(await screen.findByText('No hay actividad con esos filtros.')).toBeInTheDocument()
  })

  it('muestra el error con reintento y vuelve a consultar', async () => {
    responder(new Error('boom'))
    abrir()

    expect(await screen.findByText('No pudimos cargar la actividad.')).toBeInTheDocument()
    responder([fila(1)])
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Detalle 1')).toBeInTheDocument()
  })

  it('una respuesta vieja no pisa a la más nueva (última petición gana)', async () => {
    let resolverLenta: (valor: unknown) => void = () => {}
    const lenta = new Promise((resolver) => { resolverLenta = resolver })
    mocks.rpc.mockImplementation((nombre: string, params: Record<string, unknown>) => {
      if (nombre === 'opciones_actividad') return Promise.resolve({ data: OPCIONES, error: null })
      return params.p_empresa === 'e-2' ? Promise.resolve({ data: [fila(2)], error: null }) : lenta
    })
    abrir()

    await elegir('Tienda', 'Mundo JC')
    expect(await screen.findByText('Detalle 2')).toBeInTheDocument()

    await act(async () => resolverLenta({ data: [fila(1)], error: null }))
    expect(screen.queryByText('Detalle 1')).not.toBeInTheDocument()
    expect(screen.getByText('Detalle 2')).toBeInTheDocument()
  })
})
