import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  empresa: vi.fn(),
  regla: vi.fn(),
  rpc: vi.fn(),
  nivel: vi.fn(),
  setWarnWhen: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.setWarnWhen }) }))
vi.mock('../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: mocks.nivel(), isLoading: false }) }))
vi.mock('../../hooks/useCotizacionInicial', () => ({
  useCotizacionInicial: () => ({ cotizacion: { valor: 1465, fecha: '2026-09-25T15:00:00Z' }, cargando: false, hayError: false, recargar: vi.fn() }),
}))
vi.mock('../../hooks/useEmpresasAccesibles', () => ({
  useEmpresasAccesibles: () => ({
    empresas: [
      { id: 'e-1', nombre: 'San Javucho', esActiva: false, rolId: null },
      { id: 'e-2', nombre: 'Mundo JC', esActiva: true, rolId: null },
    ],
    empresaActivaId: 'e-2',
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    schema: () => ({
      from: (tabla: string) => ({
        select: () => ({
          eq: (_columna: string, valor: string) => ({
            maybeSingle: () => (tabla === 'empresas' ? mocks.empresa(valor) : mocks.regla(valor)),
          }),
        }),
      }),
    }),
    // `guardar` usa `.single()`; la vista previa espera el resultado directo.
    rpc: (nombre: string, args: unknown) => {
      const resultado = mocks.rpc(nombre, args)
      return { single: () => resultado, then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, ko) }
    },
  },
}))

import { EmpresaPrecios } from './precios'

const empresas: Record<string, { id: string; nombre: string }> = {
  'e-2': { id: 'e-2', nombre: 'Mundo JC' },
  'e-1': { id: 'e-1', nombre: 'San Javucho' },
}
const filasPara = (args: { p_empresa: string; p_base: string; p_ajuste_pct: number }) => [
  {
    producto_id: 'p-1',
    nombre: 'Joystick Pro cableado',
    sku: 'JOY-1',
    moneda: 'USD',
    central_ars: 29300,
    neto_ars: args.p_base === 'central_ajuste' ? Math.round((29300 * (1 + args.p_ajuste_pct / 100)) / 10) * 10 : 29300,
  },
  { producto_id: 'p-2', nombre: 'Cable USB', sku: 'CAB-1', moneda: 'USD', central_ars: null, neto_ars: null },
]

const abrir = (ruta = '/empresas/edit/e-2/precios') =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/empresas/edit/:id/precios" element={<EmpresaPrecios />} />
      </Routes>
    </MemoryRouter>,
  )

const sinRegla = { data: null, error: null }
const conRegla = (base: string, ajuste: number, updated_at = '2026-10-22T10:00:00.000Z') => ({ data: { base, ajuste_pct: ajuste, updated_at }, error: null })

describe('EmpresaPrecios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nivel.mockReturnValue('edicion')
    mocks.empresa.mockImplementation((id: string) => Promise.resolve({ data: empresas[id] ?? null, error: null }))
    mocks.regla.mockResolvedValue(sinRegla)
    mocks.rpc.mockImplementation((nombre: string, args: { p_empresa: string; p_base: string; p_ajuste_pct: number }) =>
      nombre === 'previsualizar_precios_empresa'
        ? Promise.resolve({ data: filasPara(args), error: null })
        : Promise.resolve({ data: { base: args.p_base, ajuste_pct: args.p_ajuste_pct, updated_at: '2026-10-22T11:00:00.000Z' }, error: null }),
    )
  })

  it('muestra los bloques del prototipo con la empresa sin regla como «Igual al central»', async () => {
    abrir()
    expect(await screen.findByRole('heading', { name: 'Precio de venta de Mundo JC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Igual al central' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Central con ajuste' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText('Ajuste sobre el precio central')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Redondeo')).toHaveValue('Al $ 10 más cercano')
    expect(screen.getByLabelText('Redondeo')).toBeDisabled()
    expect(screen.getByLabelText('Moneda de la tienda')).toHaveValue('ARS · Peso argentino')
    expect(screen.getByLabelText('Cotización que usa')).toHaveValue('La general del sistema')
    expect(screen.getByText(/Dólar vigente \$ 1\.465/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Precios y moneda' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'Cambiar a San Javucho ↔' })).toHaveAttribute('href', '/empresas/edit/e-1/precios')
    expect(screen.queryByRole('link', { name: /Cambiar a Mundo JC/ })).not.toBeInTheDocument()
  })

  it('«Así quedan los precios» lee el servidor y marca «sin precio» si falta la cotización', async () => {
    abrir()
    const tabla = await screen.findByRole('table', { name: 'Así quedan los precios' })
    expect(await within(tabla).findByText('Joystick Pro cableado')).toBeInTheDocument()
    expect(within(tabla).getByText('Mundo JC · Sin IVA')).toBeInTheDocument()
    expect(within(tabla).getAllByText('$ 29.300')).toHaveLength(2)
    expect(within(tabla).getAllByLabelText('Sin precio: falta cargar la cotización')).toHaveLength(2)
  })

  it('la vista previa sigue el ajuste sin guardar y guardar manda la regla con el updated_at leído', async () => {
    mocks.regla.mockResolvedValue(conRegla('central', 0))
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Central con ajuste' }))
    fireEvent.change(screen.getByLabelText('Ajuste sobre el precio central'), { target: { value: '8' } })
    expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(true)

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_precios_empresa', { p_empresa: 'e-2', p_base: 'central_ajuste', p_ajuste_pct: 8 }),
    )
    expect(await screen.findByText('$ 31.640')).toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('guardar_regla_precio_empresa', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Precios de la empresa guardados')).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_regla_precio_empresa', {
      p_empresa: 'e-2',
      p_base: 'central_ajuste',
      p_ajuste_pct: 8,
      p_updated_at: '2026-10-22T10:00:00.000Z',
      p_mostrar_con_iva: false,
    })
    await waitFor(() => expect(mocks.setWarnWhen).toHaveBeenLastCalledWith(false))
  })

  it('acepta coma decimal y signo menos tipográfico', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Central con ajuste' }))
    fireEvent.change(screen.getByLabelText('Ajuste sobre el precio central'), { target: { value: '−2,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('guardar_regla_precio_empresa', expect.objectContaining({ p_ajuste_pct: -2.5, p_updated_at: null })),
    )
  })

  it('un ajuste fuera de rango se rechaza en el campo sin llamar al servidor', async () => {
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Central con ajuste' }))
    fireEvent.change(screen.getByLabelText('Ajuste sobre el precio central'), { target: { value: '-100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('El ajuste debe ser mayor a −100 %.')).toBeInTheDocument()
    expect(screen.getByLabelText('Ajuste sobre el precio central')).toBeInvalid()
    expect(mocks.rpc).not.toHaveBeenCalledWith('guardar_regla_precio_empresa', expect.anything())
    expect(screen.getByText('Corregí el ajuste')).toBeInTheDocument()
  })

  it('un conflicto de edición avisa con claridad y ofrece recargar', async () => {
    mocks.regla.mockResolvedValue(conRegla('central', 0))
    mocks.rpc.mockImplementation((nombre: string, args: { p_empresa: string; p_base: string; p_ajuste_pct: number }) =>
      nombre === 'previsualizar_precios_empresa'
        ? Promise.resolve({ data: filasPara(args), error: null })
        : Promise.resolve({ data: null, error: { code: '40001', message: 'raw' } }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Central con ajuste' }))
    fireEvent.change(screen.getByLabelText('Ajuste sobre el precio central'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/Otra persona modificó los precios de esta empresa/)).toBeInTheDocument()
    expect(screen.queryByText('raw')).not.toBeInTheDocument()
    mocks.regla.mockResolvedValue(conRegla('central_ajuste', 3, '2026-10-22T12:00:00.000Z'))
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(await screen.findByLabelText('Ajuste sobre el precio central')).toHaveValue('3')
  })

  it('sin permiso de edición la regla es de solo lectura y no hay Guardar', async () => {
    mocks.nivel.mockReturnValue('lectura')
    mocks.regla.mockResolvedValue(conRegla('central_ajuste', 8))
    abrir()
    expect(await screen.findByText('Solo lectura')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Ajuste sobre el precio central')).toBeDisabled()
    expect(screen.getByLabelText('Ajuste sobre el precio central')).toHaveValue('8')
    expect(screen.getByRole('button', { name: 'Igual al central' })).toBeDisabled()
  })

  it('abrir otra empresa no arrastra la regla, el aviso ni los precios de la anterior', async () => {
    mocks.regla.mockImplementation((id: string) =>
      Promise.resolve(id === 'e-2' ? conRegla('central_ajuste', 8) : conRegla('central_ajuste', -5, '2026-10-22T09:00:00.000Z')),
    )
    abrir()
    expect(await screen.findByLabelText('Ajuste sobre el precio central')).toHaveValue('8')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Precios de la empresa guardados')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Cambiar a San Javucho ↔' }))

    expect(await screen.findByRole('heading', { name: 'Precio de venta de San Javucho' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ajuste sobre el precio central')).toHaveValue('-5')
    expect(screen.queryByText('Precios de la empresa guardados')).not.toBeInTheDocument()
    expect(mocks.regla).toHaveBeenCalledWith('e-1')
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_precios_empresa', { p_empresa: 'e-1', p_base: 'central_ajuste', p_ajuste_pct: -5 }),
    )
    // Los precios de la tabla son los de la empresa nueva, no los de Mundo JC (+8 %).
    expect(await screen.findByText('$ 27.840')).toBeInTheDocument()
    expect(screen.queryByText('$ 31.640')).not.toBeInTheDocument()
  })

  it('una respuesta tardía de guardar de la empresa anterior no marca como guardada a la nueva', async () => {
    mocks.regla.mockResolvedValue(conRegla('central', 0))
    let resolver: (valor: unknown) => void = () => {}
    mocks.rpc.mockImplementation((nombre: string, args: { p_empresa: string; p_base: string; p_ajuste_pct: number }) =>
      nombre === 'previsualizar_precios_empresa'
        ? Promise.resolve({ data: filasPara(args), error: null })
        : new Promise((resolve) => { resolver = resolve }),
    )
    abrir()
    fireEvent.click(await screen.findByRole('button', { name: 'Central con ajuste' }))
    fireEvent.change(screen.getByLabelText('Ajuste sobre el precio central'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    fireEvent.click(screen.getByRole('link', { name: 'Cambiar a San Javucho ↔' }))
    expect(await screen.findByRole('heading', { name: 'Precio de venta de San Javucho' })).toBeInTheDocument()
    resolver({ data: { base: 'central_ajuste', ajuste_pct: 8, updated_at: '2026-10-22T11:00:00.000Z' }, error: null })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Igual al central' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByText('Precios de la empresa guardados')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ajuste sobre el precio central')).not.toBeInTheDocument()
  })

  it('si no se puede cargar la regla muestra el error y permite reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.regla.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    abrir()
    expect(await screen.findByText('No pudimos cargar los precios de la empresa.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Precio de venta de Mundo JC' })).toBeInTheDocument()
  })

  it('una empresa inexistente o ajena se informa sin mostrar precios', async () => {
    abrir('/empresas/edit/e-9/precios')
    expect(await screen.findByText('Empresa no encontrada')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
