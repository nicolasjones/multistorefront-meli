import { useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { ReglaPrecio } from '../lib/precios'
import { listarCatalogoTienda } from '../lib/tiendaCatalogo'
import { useVersionEmpresaActiva } from './useVersionEmpresaActiva'

// Datos reales que muestra el listado de Empresas por fila. Cada dato falla por separado: un error al leer las tiendas
// no tapa los precios ni los productos (`null`/`undefined` = no se pudo leer; se muestra «No disponible»).
export type ResumenEmpresa = {
  // string = dominio; null = la empresa no tiene tienda; undefined = no se pudo leer.
  dominioTienda: string | null | undefined
  regla: ReglaPrecio | null
  productosVisibles: number | null
}

type FilaTienda = { empresa_id: string; dominio: string }
type FilaRegla = { empresa_id: string; base: ReglaPrecio['base']; ajuste_pct: number | string; mostrar_con_iva?: boolean; updated_at: string }

async function intentar<T>(lectura: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const { data, error } = await lectura()
    if (error) throw error
    return data
  } catch (error) {
    console.error('No se pudo leer un dato del resumen de empresas', error instanceof Error ? error.message : error)
    return null
  }
}

// Una consulta por dato para TODAS las empresas (no tres por empresa). Los productos visibles salen de la base
// (`listar_catalogo_tienda`, que resuelve la visibilidad efectiva) y solo se piden para las empresas que tienen tienda.
// Se vuelve a leer al cambiar la lista de empresas o la empresa activa; «última petición gana».
export function useResumenEmpresas(empresaIds: string[]) {
  const [resumenes, setResumenes] = useState<Record<string, ResumenEmpresa>>({})
  const version = useVersionEmpresaActiva()
  const clave = empresaIds.join(',')

  useEffect(() => {
    let vigente = true
    if (!clave) return undefined
    const ids = clave.split(',')
    void (async () => {
      const [tiendas, reglas] = await Promise.all([
        intentar<FilaTienda[]>(() => supabaseClient.schema('dominio').from('tiendas').select('empresa_id, dominio').in('empresa_id', ids).returns<FilaTienda[]>()),
        intentar<FilaRegla[]>(() => supabaseClient.schema('dominio').from('precios_empresa').select('empresa_id, base, ajuste_pct, mostrar_con_iva, updated_at').in('empresa_id', ids).returns<FilaRegla[]>()),
      ])
      const dominios = new Map((tiendas ?? []).map((fila) => [fila.empresa_id, fila.dominio]))
      const visibles = new Map<string, number | null>()
      await Promise.all(ids.map(async (id) => {
        if (!dominios.has(id)) { visibles.set(id, tiendas === null ? null : 0); return }
        try {
          visibles.set(id, (await listarCatalogoTienda(id)).resumen.visibles)
        } catch (error) {
          console.error('No se pudo leer el catálogo de la tienda', error instanceof Error ? error.message : error)
          visibles.set(id, null)
        }
      }))
      if (!vigente) return
      const porEmpresa: Record<string, ResumenEmpresa> = {}
      for (const id of ids) {
        const fila = reglas?.find((regla) => regla.empresa_id === id)
        porEmpresa[id] = {
          dominioTienda: tiendas === null ? undefined : dominios.get(id) ?? null,
          // Sin fila guardada rige «Igual al central».
          regla: reglas === null ? null : fila
            ? { base: fila.base, ajustePct: Number(fila.ajuste_pct), mostrarConIva: fila.mostrar_con_iva === true, actualizadoEn: fila.updated_at }
            : { base: 'central', ajustePct: 0, mostrarConIva: false, actualizadoEn: null },
          productosVisibles: visibles.get(id) ?? null,
        }
      }
      setResumenes(porEmpresa)
    })()
    return () => { vigente = false }
  }, [clave, version])

  return resumenes
}
