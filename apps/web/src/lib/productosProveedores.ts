import type { SupabaseClient } from '@supabase/supabase-js'
import { mensajeDeErrorBase } from './mensajeErrorBase'
import { parsearImporte } from './productos'

// Varios proveedores por producto, con uno principal (MSF-530, migración 20270509000100). El proveedor principal sigue
// siendo el selector «Proveedor» del formulario del producto (espejo en `productos.proveedor_id`); acá se administran
// todos los vínculos con su código y su costo. La autoridad es la base: las RPC validan rol, organización y datos.

export const LARGO_CODIGO_PROVEEDOR = 80

export type ProveedorDeProducto = {
  proveedorId: string
  razonSocial: string
  activo: boolean
  codigoProveedor: string | null
  // null: el rol no ve Rentabilidad o el vínculo no tiene costo.
  costo: number | null
  principal: boolean
}

type FilaVinculo = {
  proveedor_id: string
  razon_social: string
  activo: boolean
  codigo_proveedor: string | null
  costo: number | string | null
  principal: boolean
}

export async function leerProveedoresDeProducto(cliente: SupabaseClient, productoId: string): Promise<ProveedorDeProducto[]> {
  const { data, error } = await cliente.rpc('listar_proveedores_de_producto', { p_producto_id: productoId })
  if (error) throw error
  return ((data ?? []) as FilaVinculo[]).map((fila) => ({
    proveedorId: fila.proveedor_id,
    razonSocial: fila.razon_social,
    activo: fila.activo,
    codigoProveedor: fila.codigo_proveedor,
    costo: fila.costo === null ? null : Number(fila.costo),
    principal: fila.principal,
  }))
}

export type FormularioVinculo = { codigo: string; costo: string; principal: boolean }
export type ErroresVinculo = Partial<Record<'codigo' | 'costo', string>>

export function validarVinculo(formulario: FormularioVinculo, conCosto: boolean): ErroresVinculo {
  const errores: ErroresVinculo = {}
  if (formulario.codigo.trim().length > LARGO_CODIGO_PROVEEDOR) {
    errores.codigo = `El código no puede superar los ${LARGO_CODIGO_PROVEEDOR} caracteres.`
  }
  if (conCosto && formulario.costo.trim() !== '' && parsearImporte(formulario.costo) === null) {
    errores.costo = 'Ingresá un costo válido, con hasta 2 decimales.'
  }
  return errores
}

export function aFormularioVinculo(vinculo: ProveedorDeProducto | null): FormularioVinculo {
  return {
    codigo: vinculo?.codigoProveedor ?? '',
    costo: vinculo?.costo === null || vinculo === null ? '' : String(vinculo.costo).replace('.', ','),
    principal: vinculo?.principal ?? false,
  }
}

// `conCosto` = edición en Rentabilidad: sin ella el costo no viaja (la base lo rechaza y conserva el existente).
export async function asignarProveedorProducto(
  cliente: SupabaseClient,
  datos: { productoId: string; proveedorId: string; formulario: FormularioVinculo; conCosto: boolean },
): Promise<void> {
  const costo = datos.conCosto && datos.formulario.costo.trim() !== '' ? parsearImporte(datos.formulario.costo) : null
  if (datos.conCosto && datos.formulario.costo.trim() !== '' && costo === null) throw new Error('El costo no es válido')
  const { error } = await cliente.rpc('asignar_proveedor_producto', {
    p_producto_id: datos.productoId,
    p_proveedor_id: datos.proveedorId,
    p_codigo_proveedor: datos.formulario.codigo.trim() === '' ? null : datos.formulario.codigo.trim(),
    p_costo: costo,
    p_principal: datos.formulario.principal,
  })
  if (error) throw error
}

export async function quitarProveedorProducto(cliente: SupabaseClient, productoId: string, proveedorId: string): Promise<void> {
  const { error } = await cliente.rpc('quitar_proveedor_producto', { p_producto_id: productoId, p_proveedor_id: proveedorId })
  if (error) throw error
}

export async function marcarProveedorPrincipal(cliente: SupabaseClient, productoId: string, proveedorId: string): Promise<void> {
  const { error } = await cliente.rpc('marcar_proveedor_principal', { p_producto_id: productoId, p_proveedor_id: proveedorId })
  if (error) throw error
}

export function mensajeErrorProveedoresProducto(error: unknown, porDefecto: string): string {
  return mensajeDeErrorBase(error, porDefecto, {
    PT404: 'El producto o el proveedor ya no existe, o el proveedor ya no está en el producto. Recargá la página.',
    P0002: 'El producto o el proveedor ya no existe, o el proveedor ya no está en el producto. Recargá la página.',
    PT409: 'El proveedor está desactivado: reactivalo antes de asignarlo o marcarlo como principal.',
    '22023': 'Algún dato no es válido. Revisá el código y el costo e intentá de nuevo.',
  })
}
