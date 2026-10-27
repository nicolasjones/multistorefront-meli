import { useCallback, useEffect, useRef, useState } from 'react'
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

const COLUMNAS = 'id, nombre, whatsapp, correo, instagram, direccion, horarios, razon_social, cuit, activa'

// Una empresa por id en `dominio` (esquema por consulta, ver decisión T001).
// RLS decide: una empresa de otra organización devuelve cero filas y se
// reporta como `noEncontrada`, igual que un id inexistente.
export function useEmpresa(id: string | undefined) {
  const [empresa, setEmpresa] = useState<EmpresaDetalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)
  const idVigente = useRef(id)
  useEffect(() => {
    idVigente.current = id
  }, [id])
  const esVigente = useCallback((otroId: string | undefined) => idVigente.current === otroId, [])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: { data: EmpresaDetalle | null; error: unknown }
    try {
      resultado = await supabaseClient
        .schema('dominio')
        .from('empresas')
        .select(COLUMNAS)
        .eq('id', id ?? '')
        .maybeSingle<EmpresaDetalle>()
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
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('empresas')
        .update(valores)
        .eq('id', id ?? '')
        .select(COLUMNAS)
        .maybeSingle<EmpresaDetalle>()
      if (error) throw error
      // RLS rechaza sin error visible: cero filas afectadas.
      if (!data) throw new Error('No tenés permiso para guardar los cambios de esta empresa.')
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
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('empresas')
        .update({ activa })
        .eq('id', id ?? '')
        .eq('activa', !activa)
        .select(COLUMNAS)
        .maybeSingle<EmpresaDetalle>()
      if (error) throw error
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
