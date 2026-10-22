import { useCallback, useEffect, useRef, useState } from 'react'
import { useInvalidate } from '@refinedev/core'
import { usePermisosPanel } from '../context/PermisosPanel'
import { cambiarEmpresaActiva, listarEmpresasSelector, usarTodasLasEmpresas, type EmpresaSelector } from '../lib/empresaActiva'
import { notificarEmpresaActivaCambiada } from '../lib/empresaActivaRevision'
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

  // Cambio efectivo (elegir una empresa o pasar a «Todas mis empresas»): RPC →
  // invalidar caché de permisos → recargar el panel → releer el selector.
  const aplicarCambio = useCallback(async (accion: () => Promise<void>): Promise<boolean> => {
    setCambiando(true)
    setErrorCambio(null)
    try {
      await accion()
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
    // Avisa a las pantallas con filtro por tienda (useEmpresasAccesibles).
    notificarEmpresaActivaCambiada()
    await cargar()
    setCambiando(false)
    return true
  }, [cargar, recargarPermisos, invalidar])

  const cambiar = useCallback(
    (empresaId: string) => aplicarCambio(() => cambiarEmpresaActiva(empresaId)),
    [aplicarCambio],
  )

  const cambiarATodas = useCallback(() => aplicarCambio(usarTodasLasEmpresas), [aplicarCambio])

  // Vista combinada: hay empresas pero ninguna es la activa.
  const esTodas = empresas.length > 0 && !empresas.some((empresa) => empresa.esActiva)

  return { empresas, esTodas, isLoading: cargando, isError: hayError, cambiando, errorCambio, cambiar, cambiarATodas, limpiarError, refetch: cargar }
}
