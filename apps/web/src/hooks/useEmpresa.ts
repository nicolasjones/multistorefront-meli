import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export type DatosGeneralesEmpresa = {
  nombre: string
  whatsapp: string | null
  correo: string | null
  instagram: string | null
  direccion: string | null
  horarios: string | null
  // F-VTA-19 (FR-008): se imprimen en la factura y el remito.
  razon_social: string | null
  cuit: string | null
}

export type EmpresaDetalle = DatosGeneralesEmpresa & { id: string; activa: boolean }

// CUIT, correo y WhatsApp ya no se leen de la tabla (la base los reserva a la sección `empresas`): el detalle sale de la
// RPC `empresa_datos`, que exige esa sección. Las escrituras siguen siendo UPDATE por columnas; su respuesta solo
// confirma la fila (`id`) y los datos se releen por la RPC.
async function leerDetalle(id: string): Promise<{ data: EmpresaDetalle | null; error: unknown }> {
  const { data, error } = await supabaseClient.rpc('empresa_datos', { p_empresa: id })
  if (error) return { data: null, error }
  return { data: ((data ?? []) as EmpresaDetalle[])[0] ?? null, error: null }
}

// Una empresa por id en `dominio` (esquema por consulta, ver decisión T001).
// RLS decide: una empresa de otra organización devuelve cero filas y se
// reporta como `noEncontrada`, igual que un id inexistente.
export function useEmpresa(id: string | undefined) {
  const [empresa, setEmpresa] = useState<EmpresaDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)
  const idVigente = useRef(id)
  useLayoutEffect(() => {
    idVigente.current = id
  }, [id])
  const esVigente = useCallback((otroId: string | undefined) => idVigente.current === otroId, [])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    // Sin id (la empresa activa aún no resolvió) no se consulta: se queda cargando, sin «no encontrada».
    if (!id) {
      setCargando(true)
      setHayError(false)
      setEmpresa(null)
      return
    }
    setCargando(true)
    let resultado: { data: EmpresaDetalle | null; error: unknown }
    try {
      resultado = await leerDetalle(id)
    } catch (excepcion) {
      resultado = { data: null, error: excepcion }
    }
    if (peticion !== ultimaPeticion.current) return
    setHayError(Boolean(resultado.error))
    setEmpresa(resultado.error ? null : resultado.data)
    setCargando(false)
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const actualizar = useCallback(
    async (valores: DatosGeneralesEmpresa) => {
      if (!id) throw new Error('La empresa todavía no se cargó.')
      const { data: tocada, error } = await supabaseClient
        .schema('dominio')
        .from('empresas')
        .update(valores)
        .eq('id', id)
        .select('id')
        .maybeSingle<{ id: string }>()
      if (error) throw error
      // RLS rechaza sin error visible: cero filas afectadas.
      if (!tocada) throw new Error('No tenés permiso para guardar los cambios de esta empresa.')
      const { data, error: errorLectura } = await leerDetalle(id)
      if (errorLectura) throw errorLectura
      if (!data) throw new Error('No pudimos leer la empresa guardada. Recargá la página.')
      // Una respuesta tardía de otra empresa no pisa a la que se ve ahora.
      if (idVigente.current === id) setEmpresa(data)
      return data
    },
    [id],
  )

  // Pausar/reactivar toca solo `activa` de esta empresa (FR-008): las demás
  // filas no se ven afectadas porque el update filtra por id. El update es
  // condicional al estado previo: si otro administrador ya lo cambió no toca
  // nada y se recarga, para no emitir un evento de actividad falso.
  const cambiarEstado = useCallback(
    async (activa: boolean) => {
      if (!id) throw new Error('La empresa todavía no se cargó.')
      const { data: tocada, error } = await supabaseClient
        .schema('dominio')
        .from('empresas')
        .update({ activa })
        .eq('id', id)
        .eq('activa', !activa)
        .select('id')
        .maybeSingle<{ id: string }>()
      if (error) throw error
      const { data, error: errorLectura } = tocada ? await leerDetalle(id) : { data: null, error: null }
      if (errorLectura) throw errorLectura
      // Cero filas: estado ya cambiado por otro administrador, sin permiso o
      // empresa inexistente (RLS no distingue). Se recarga para mostrar la real.
      if (!data) {
        if (idVigente.current === id) void cargar()
        throw new Error('No se pudo cambiar el estado: otra persona ya lo cambió, no tenés permiso o la empresa ya no existe.')
      }
      if (idVigente.current === id) setEmpresa(data)
      return data
    },
    [id, cargar],
  )

  return { empresa, isLoading: cargando, isError: hayError, noEncontrada: !cargando && !hayError && empresa === null, refetch: cargar, actualizar, cambiarEstado, esVigente }
}
