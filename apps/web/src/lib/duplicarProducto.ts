// Duplicar producto (F-CAT-13, Decisión 4 de la spec). Lee el origen y arma lo que precarga el alta:
// nombre, descripción, «Compatible con», moneda, precio de lista, categoría y empresas (y costo y
// proveedor solo con acceso a Rentabilidad). SKU y código de barras quedan vacíos (el segundo es
// único), no se copian imágenes ni stock y el producto nuevo nace activo. No escribe nada.
import type { SupabaseClient } from '@supabase/supabase-js'
import { FORMULARIO_PRODUCTO_VACIO, type FormularioProducto, type Producto } from './productos'
import { leerEmpresasProducto } from './productoEmpresas'

export const PARAMETRO_DUPLICAR = 'duplicar_de'
export const AVISO_ORIGEN_NO_ENCONTRADO = 'No encontramos el producto a duplicar. Cargá uno nuevo desde cero.'

const COLUMNAS_ORIGEN = 'id, nombre, descripcion, compatible_con, moneda, precio_lista, proveedor_id, categoria_id'

export type OrigenDuplicado = { formulario: FormularioProducto; empresaIds: string[]; categoriaId: string }

type FilaOrigen = Pick<Producto, 'id' | 'nombre' | 'descripcion' | 'compatible_con' | 'moneda' | 'precio_lista' | 'proveedor_id'> & { categoria_id: string | null }

// `null` = el origen no existe o es de otra organización (RLS lo oculta): el alta queda vacía con aviso.
export async function leerOrigenDuplicado(
  cliente: Pick<SupabaseClient, 'schema'>,
  id: string,
  { conCosto }: { conCosto: boolean },
): Promise<OrigenDuplicado | null> {
  const { data, error } = await cliente.schema('dominio').from('productos').select(COLUMNAS_ORIGEN).eq('id', id).maybeSingle<FilaOrigen>()
  if (error) throw error
  if (!data) return null
  let costo = ''
  if (conCosto) {
    const { data: fila, error: errorCosto } = await cliente
      .schema('dominio')
      .from('producto_costos')
      .select('costo')
      .eq('producto_id', data.id)
      .maybeSingle<{ costo: number | string }>()
    if (errorCosto) throw errorCosto
    costo = fila ? String(fila.costo) : ''
  }
  const empresaIds = await leerEmpresasProducto(cliente, data.id)
  return {
    formulario: {
      ...FORMULARIO_PRODUCTO_VACIO,
      nombre: data.nombre,
      descripcion: data.descripcion ?? '',
      compatible_con: (data.compatible_con ?? []).join(', '),
      moneda: data.moneda,
      precio_lista: String(data.precio_lista),
      costo,
      proveedor_id: conCosto ? (data.proveedor_id ?? '') : '',
    },
    empresaIds,
    categoriaId: data.categoria_id ?? '',
  }
}
