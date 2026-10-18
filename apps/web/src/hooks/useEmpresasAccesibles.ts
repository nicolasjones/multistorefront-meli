import { useCallback, useEffect, useRef, useState } from 'react'
import { listarEmpresasSelector, type EmpresaSelector } from '../lib/empresaActiva'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Empresas sobre las que el usuario puede trabajar (F-ROL-06, F-CLI-11). Sale
// del mismo RPC que el selector de la barra superior, `empresas_para_selector()`
// → `private.empresas_accesibles()`: el Administrador ve todas las activas de su
// organización, un miembro las asignadas y el superadmin las de su organización
// activa. Así el filtro de pantalla no ofrece empresas que la persona no puede
// usar ni se contradice con el selector del encabezado.
export function useEmpresasAccesibles() {
  const [empresas, setEmpresas] = useState<EmpresaSelector[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ultimaPeticion = useRef(0)

  // «Última petición gana»: si cambia la organización activa (superadmin) y hay
  // dos cargas en vuelo, la respuesta vieja se descarta.
  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const lista = await listarEmpresasSelector()
      if (peticion !== ultimaPeticion.current) return
      setEmpresas(lista)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No se pudieron cargar las empresas accesibles', error instanceof Error ? error.message : error)
      setEmpresas([])
      setHayError(true)
    }
    setCargando(false)
    // organizacionId solo dispara la recarga; la organización la resuelve la base.
  }, [organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const empresaActivaId = empresas.find((empresa) => empresa.esActiva)?.id ?? null
  return { empresas, empresaActivaId, isLoading: cargando, isError: hayError, refetch: cargar }
}
