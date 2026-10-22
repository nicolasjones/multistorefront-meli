import { useCallback, useEffect, useRef, useState } from 'react'
import { useInvalidate } from '@refinedev/core'
import { usePermisosPanel } from '../context/PermisosPanel'
import { avisarCambioEmpresaActiva } from '../lib/cambioEmpresaActiva'
import { cambiarEmpresaActiva, listarEmpresasSelector, type EmpresaSelector } from '../lib/empresaActiva'
import { invalidarCachePermisos } from '../lib/permisos'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Empresas elegibles del usuario y cambio de la activa (F-ROL-06). Tras cambiar:
// RPC → invalidarCachePermisos() → recarga de PermisosPanelProvider, para que los
// botones de edición reflejen el rol de la nueva empresa (FR-012).
export function useEmpresaActiva() {
  const [empresas, setEmpresas] = useState<EmpresaSelector[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [errorCambio, setErrorCambio] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState(false)
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const recargarPermisos = usePermisosPanel()?.recargar
  const invalidar = useInvalidate()
  const ultimaPeticion = useRef(0)

  // «Última petición gana»: una respuesta vieja no pisa a la más reciente.
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
      console.error('No se pudieron cargar las empresas del selector', error instanceof Error ? error.message : error)
      setEmpresas([])
      setHayError(true)
    }
    setCargando(false)
    // organizacionId solo dispara la recarga; la organización la resuelve la base.
  }, [organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const limpiarError = useCallback(() => setErrorCambio(null), [])

  const cambiar = useCallback(async (empresaId: string): Promise<boolean> => {
    setCambiando(true)
    setErrorCambio(null)
    try {
      await cambiarEmpresaActiva(empresaId)
    } catch (error) {
      console.error('No se pudo cambiar la empresa activa', error instanceof Error ? error.message : error)
      setErrorCambio('No pudimos cambiar la empresa. Probá de nuevo.')
      setCambiando(false)
      return false
    }
    invalidarCachePermisos()
    recargarPermisos?.()
    // El Sider cachea accessControlProvider.can en react-query: sin esto seguiría con el rol anterior.
    void invalidar({ resource: 'access', invalidates: ['all'] })
    // Datos de todas las resources: ningún listado queda con filas de la empresa anterior.
    void invalidar({ invalidates: ['all'] })
    // Reencuadra la pantalla abierta: remonta el contenido (paginación, selección y diálogos).
    avisarCambioEmpresaActiva()
    await cargar()
    setCambiando(false)
    return true
  }, [cargar, recargarPermisos, invalidar])

  return { empresas, isLoading: cargando, isError: hayError, cambiando, errorCambio, cambiar, limpiarError, refetch: cargar }
}
