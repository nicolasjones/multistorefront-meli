import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useClientesInactivos: vi.fn(), refetch: vi.fn() }))

vi.mock('../../hooks/useClientesInactivos', () => ({ useClientesInactivos: mocks.useClientesInactivos }))

import type { FilaInactivo } from '../../hooks/useClientesInactivos'
import { validarDias } from '../../lib/diasInactivos'
import { ClientesInactivos } from './ClientesInactivos'

const fila = (n: number, extra: Partial<FilaInactivo> = {}): FilaInactivo => ({
  cliente_id: `c-${n}`, numero: n, nombre: `Cliente ${n}`, tipo: 'minorista', ultima_compra: '2026-06-01',
  dias_sin_comprar: 150, comprobantes: 3, facturado: 1234567, ...extra,
})

const respuesta = (filas: FilaInactivo[], extra: Record<string, unknown> = {}) => ({
  filas, total: filas.length, isLoading: false, isFetching: false, isError: false, refetch: mocks.refetch, ...extra,
})

const ultimosParametros = () => mocks.useClientesInactivos.mock.calls.at(-1)![0]
const abrir = (empresaId: string | null = null) => render(<MemoryRouter><ClientesInactivos empresaId={empresaId} /></MemoryRouter>)

describe('validarDias', () => {
  it.each(['1', '90', '3650', ' 45 '])('acepta %s', (texto) => {
    expect('dias' in validarDias(texto)).toBe(true)
  })
  it.each(['', '  ', '0', '3651', '-5', '1.5', 'abc', '9e2'])('rechaza «%s»', (texto) => {
    expect('error' in validarDias(texto)).toBe(true)
  })
})

describe('ClientesInactivos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useClientesInactivos.mockReturnValue(respuesta([fila(1), fila(2, { tipo: 'mayorista', dias_sin_comprar: 100, ultima_compra: '2026-07-20' })]))
  })

  it('arranca con 90 días, sin Consumidor final y sin tipo', () => {
    abrir()
    expect(ultimosParametros()).toEqual({ dias: 90, tipo: null, incluirConsumidorFinal: false, empresaId: null, pagina: 1, tamano: 25 })
    expect(screen.getByLabelText('Días sin comprar')).toHaveValue('90')
  })

  it('muestra la tabla con última compra, días, comprobantes y facturado, y enlaza a la ficha', () => {
    abrir()
    const tabla = screen.getByRole('table', { name: 'Clientes inactivos' })
    expect(tabla).toBeInTheDocument()
    for (const encabezado of ['Cliente', 'Tipo', 'Última compra', 'Días sin comprar', 'Comprobantes', 'Facturado histórico']) {
      expect(screen.getByRole('columnheader', { name: encabezado })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Cliente 1' })).toHaveAttribute('href', '/clientes/show/c-1')
    expect(screen.getByText('01/06/2026')).toBeInTheDocument()
    expect(screen.getAllByText('$ 1.234.567').length).toBeGreaterThan(0)
  })

  it('valida el umbral junto al campo y no consulta', () => {
    abrir()
    const campo = screen.getByLabelText('Días sin comprar')
    fireEvent.change(campo, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(screen.getByText('Ingresá un número entero de 1 a 3650.')).toBeInTheDocument()
    expect(ultimosParametros().dias).toBe(90)
    fireEvent.change(campo, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(ultimosParametros().dias).toBe(90)
    fireEvent.change(campo, { target: { value: '3651' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(ultimosParametros().dias).toBe(90)
  })

  it('Aplicar con un valor válido consulta con ese umbral y borra el error', () => {
    abrir()
    const campo = screen.getByLabelText('Días sin comprar')
    fireEvent.change(campo, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    fireEvent.change(campo, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(ultimosParametros().dias).toBe(45)
    expect(screen.queryByText('Ingresá un número entero de 1 a 3650.')).not.toBeInTheDocument()
  })

  it.each([30, 60, 90, 180])('el atajo de %i días consulta con ese umbral', (dias) => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: `${dias} días` }))
    expect(ultimosParametros().dias).toBe(dias)
    expect(screen.getByLabelText('Días sin comprar')).toHaveValue(String(dias))
  })

  it('los filtros de tipo y Consumidor final se aplican y vuelven a la página 1', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Mayorista' }))
    expect(ultimosParametros().tipo).toBe('mayorista')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Consumidor final' }))
    expect(ultimosParametros().incluirConsumidorFinal).toBe(true)
    expect(ultimosParametros().pagina).toBe(1)
  })

  it('manda la empresa activa y al cambiarla vuelve a la página 1', () => {
    mocks.useClientesInactivos.mockReturnValue(respuesta(Array.from({ length: 25 }, (_, i) => fila(i + 1)), { total: 60 }))
    const { rerender } = render(<MemoryRouter><ClientesInactivos empresaId="e-1" /></MemoryRouter>)
    expect(ultimosParametros().empresaId).toBe('e-1')
    fireEvent.click(screen.getByRole('button', { name: /siguiente|next/i }))
    expect(ultimosParametros().pagina).toBe(2)
    rerender(<MemoryRouter><ClientesInactivos empresaId="e-2" /></MemoryRouter>)
    expect(ultimosParametros()).toMatchObject({ empresaId: 'e-2', pagina: 1 })
  })

  it('vacío: mensaje compartido', () => {
    mocks.useClientesInactivos.mockReturnValue(respuesta([]))
    abrir()
    expect(screen.getByText('Ningún cliente dejó de comprar en ese plazo.')).toBeInTheDocument()
  })

  it('error: estado de error con «Reintentar»', () => {
    mocks.useClientesInactivos.mockReturnValue(respuesta([], { isError: true }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('carga: muestra el estado de carga y no la tabla', () => {
    mocks.useClientesInactivos.mockReturnValue(respuesta([], { isLoading: true, isFetching: true }))
    abrir()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  })
})
