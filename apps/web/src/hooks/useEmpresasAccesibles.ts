import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { listarEmpresasSelector, type EmpresaSelector } from '../lib/empresaActiva'
import { revisionEmpresaActiva, suscribirEmpresaActiva } from '../lib/empresaActivaRevision'
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
  // Cambió la empresa activa en la barra superior: hay que releer el selector
  // para que la pantalla la siga (F-ROL-06).
  const revision = useSyncExternalStore(suscribirEmpresaActiva, revisionEmpresaActiva, revisionEmpresaActiva)
  const ultimaPeticion = useRef(0)

  // «Última petición gana»: si cambia la organización activa (superadmin) y hay
  // dos cargas en vuelo, la respuesta vieja se descarta.
  const cargar = useCallback(async () => {
    // `revision` no se consulta en el cuerpo: está en las dependencias para que
    // un cambio de empresa activa en la barra superior rehaga la consulta (FR-011).
    void revision
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
    // organizacionId y revision solo disparan la recarga; la organización y la
    // activa las resuelve la base.
  }, [organizacionId, revision])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const empresaActivaId = empresas.find((empresa) => empresa.esActiva)?.id ?? null
  return { empresas, empresaActivaId, isLoading: cargando, isError: hayError, refetch: cargar }
}
