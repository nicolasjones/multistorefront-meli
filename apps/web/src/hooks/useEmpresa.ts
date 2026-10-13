import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'

export type DatosGeneralesEmpresa = {
  nombre: string
  whatsapp: string | null
  correo: string | null
  instagram: string | null
  direccion: string | null
}

export type EmpresaDetalle = DatosGeneralesEmpresa & { id: string; activa: boolean }

const COLUMNAS = 'id, nombre, whatsapp, correo, instagram, direccion, activa'

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
  // filas no se ven afectadas porque el update filtra por id.
  const cambiarEstado = useCallback(
    async (activa: boolean) => {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('empresas')
        .update({ activa })
        .eq('id', id ?? '')
        .select(COLUMNAS)
        .maybeSingle<EmpresaDetalle>()
      if (error) throw error
      // Cero filas: sin permiso o la empresa ya no existe (RLS no distingue).
      if (!data) throw new Error('No se pudo cambiar el estado (sin permiso o la empresa ya no existe).')
      if (idVigente.current === id) setEmpresa(data)
      return data
    },
    [id],
  )

  return { empresa, isLoading: cargando, isError: hayError, noEncontrada: !cargando && !hayError && empresa === null, refetch: cargar, actualizar, cambiarEstado }
}
