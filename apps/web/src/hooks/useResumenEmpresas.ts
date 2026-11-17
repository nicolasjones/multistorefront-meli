import { useEffect, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import { leerReglaPrecioEmpresa, type ReglaPrecio } from '../lib/precios'
import { leerTiendaDeEmpresa } from '../lib/tienda'
import { listarCatalogoTienda } from '../lib/tiendaCatalogo'

// Datos reales que muestra el listado de Empresas por fila. Cada dato falla por separado: un error al leer la tienda
// de una empresa no tapa su precio ni las demás filas (`null` = no se pudo leer; se muestra «No disponible»).
export type ResumenEmpresa = {
  // string = dominio; null = la empresa no tiene tienda; undefined = no se pudo leer.
  dominioTienda: string | null | undefined
  regla: ReglaPrecio | null
  productosVisibles: number | null
}

type Lectura<T> = { ok: true; valor: T } | { ok: false }

const intentar = async <T,>(lectura: () => Promise<T>): Promise<Lectura<T>> => {
  try {
    return { ok: true, valor: await lectura() }
  } catch (error) {
    console.error('No se pudo leer un dato del resumen de empresas', error instanceof Error ? error.message : error)
    return { ok: false }
  }
}

// El resumen sigue a la lista de empresas: si cambia (otra organización, empresa creada) se vuelve a leer. «Última
// petición gana»: una respuesta vieja no pisa a una nueva.
export function useResumenEmpresas(empresaIds: string[]) {
  const [resumenes, setResumenes] = useState<Record<string, ResumenEmpresa>>({})
  const clave = empresaIds.join(',')

  useEffect(() => {
    let vigente = true
    setResumenes({})
    if (!clave) return undefined
    for (const id of clave.split(',')) {
      void (async () => {
        const [tienda, regla, catalogo] = await Promise.all([
          intentar(() => leerTiendaDeEmpresa(id)),
          intentar(() => leerReglaPrecioEmpresa(supabaseClient, id)),
          intentar(() => listarCatalogoTienda(id)),
        ])
        if (!vigente) return
        setResumenes((previo) => ({
          ...previo,
          [id]: {
            dominioTienda: tienda.ok ? tienda.valor?.dominio ?? null : undefined,
            regla: regla.ok ? regla.valor : null,
            productosVisibles: catalogo.ok ? catalogo.valor.resumen.visibles : null,
          },
        }))
      })()
    }
    return () => { vigente = false }
  }, [clave])

  return resumenes
}
