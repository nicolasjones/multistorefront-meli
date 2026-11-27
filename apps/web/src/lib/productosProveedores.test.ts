import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  aFormularioVinculo,
  asignarProveedorProducto,
  leerProveedoresDeProducto,
  marcarProveedorPrincipal,
  mensajeErrorProveedoresProducto,
  quitarProveedorProducto,
  validarVinculo,
} from './productosProveedores'

const rpc = vi.fn()
const cliente = { rpc } as unknown as SupabaseClient

describe('leerProveedoresDeProducto', () => {
  beforeEach(() => rpc.mockReset())

  it('mapea las filas (costo numeric de texto a número, nulo si no se ve)', async () => {
    rpc.mockResolvedValue({
      data: [
        { proveedor_id: 'a', razon_social: 'A', activo: true, codigo_proveedor: 'A-1', costo: '12.50', principal: true },
        { proveedor_id: 'b', razon_social: 'B', activo: false, codigo_proveedor: null, costo: null, principal: false },
      ],
      error: null,
    })
    await expect(leerProveedoresDeProducto(cliente, 'p-1')).resolves.toEqual([
      { proveedorId: 'a', razonSocial: 'A', activo: true, codigoProveedor: 'A-1', costo: 12.5, principal: true },
      { proveedorId: 'b', razonSocial: 'B', activo: false, codigoProveedor: null, costo: null, principal: false },
    ])
    expect(rpc).toHaveBeenCalledWith('listar_proveedores_de_producto', { p_producto_id: 'p-1' })
  })
  it('propaga el error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT404' } })
    await expect(leerProveedoresDeProducto(cliente, 'p-1')).rejects.toEqual({ code: 'PT404' })
  })
})

describe('validarVinculo', () => {
  const base = { codigo: '', costo: '', principal: false }
  it.each([[80, true], [81, false]])('código de %i caracteres válido: %s', (largo, valido) => {
    expect(validarVinculo({ ...base, codigo: 'x'.repeat(largo) }, true).codigo === undefined).toBe(valido)
  })
  it.each([['10', true], ['10,55', true], ['10,555', false], ['-1', false], ['abc', false]])('costo «%s» válido: %s', (costo, valido) => {
    expect(validarVinculo({ ...base, costo }, true).costo === undefined).toBe(valido)
  })
  it('sin edición en Rentabilidad el costo no se valida (no viaja)', () => {
    expect(validarVinculo({ ...base, costo: 'abc' }, false)).toEqual({})
  })
})

describe('asignarProveedorProducto', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: null, error: null })
  })

  it('envía código recortado, costo y marca de principal', async () => {
    await asignarProveedorProducto(cliente, { productoId: 'p', proveedorId: 'v', formulario: { codigo: ' C-1 ', costo: '10,5', principal: true }, conCosto: true })
    expect(rpc).toHaveBeenCalledWith('asignar_proveedor_producto', {
      p_producto_id: 'p', p_proveedor_id: 'v', p_codigo_proveedor: 'C-1', p_costo: 10.5, p_principal: true,
    })
  })
  it('sin edición en Rentabilidad no envía el costo aunque el formulario lo traiga', async () => {
    await asignarProveedorProducto(cliente, { productoId: 'p', proveedorId: 'v', formulario: { codigo: '', costo: '99', principal: false }, conCosto: false })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_codigo_proveedor: null, p_costo: null, p_principal: false })
  })
  it('un costo inválido no llega a la base', async () => {
    await expect(asignarProveedorProducto(cliente, { productoId: 'p', proveedorId: 'v', formulario: { codigo: '', costo: 'x', principal: false }, conCosto: true })).rejects.toThrow('El costo no es válido')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('quitar y marcar llaman a su función', async () => {
    await quitarProveedorProducto(cliente, 'p', 'v')
    await marcarProveedorPrincipal(cliente, 'p', 'v')
    expect(rpc).toHaveBeenNthCalledWith(1, 'quitar_proveedor_producto', { p_producto_id: 'p', p_proveedor_id: 'v' })
    expect(rpc).toHaveBeenNthCalledWith(2, 'marcar_proveedor_principal', { p_producto_id: 'p', p_proveedor_id: 'v' })
  })
  it('propaga el error de la base', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } })
    await expect(quitarProveedorProducto(cliente, 'p', 'v')).rejects.toEqual({ code: 'PT409' })
  })
})

describe('formulario y mensajes', () => {
  it('aFormularioVinculo de un vínculo existente y de uno nuevo', () => {
    expect(aFormularioVinculo({ proveedorId: 'a', razonSocial: 'A', activo: true, codigoProveedor: 'X', costo: 10.5, principal: true }))
      .toEqual({ codigo: 'X', costo: '10,5', principal: true })
    expect(aFormularioVinculo({ proveedorId: 'a', razonSocial: 'A', activo: true, codigoProveedor: null, costo: null, principal: false }))
      .toEqual({ codigo: '', costo: '', principal: false })
    expect(aFormularioVinculo(null)).toEqual({ codigo: '', costo: '', principal: false })
  })
  it('mensajes en castellano, sin el texto crudo de la base', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeErrorProveedoresProducto({ code: 'PT409', message: 'detalle interno' }, 'x'))
      .toBe('El proveedor está desactivado: reactivalo antes de asignarlo o marcarlo como principal.')
    expect(mensajeErrorProveedoresProducto({ code: 'PT404' }, 'x')).toBe('El producto o el proveedor ya no existe, o el proveedor ya no está en el producto. Recargá la página.')
    expect(mensajeErrorProveedoresProducto({ code: '22023' }, 'x')).toBe('Algún dato no es válido. Revisá el código y el costo e intentá de nuevo.')
    expect(mensajeErrorProveedoresProducto({ code: '42501' }, 'x')).toContain('No tenés permiso')
    expect(mensajeErrorProveedoresProducto({ code: 'XX000', message: 'detalle interno' }, 'por defecto')).toBe('por defecto')
  })
})
