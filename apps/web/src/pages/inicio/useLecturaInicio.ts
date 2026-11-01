import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { revisionEmpresaActiva, suscribirEmpresaActiva } from '../../lib/empresaActivaRevision'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'

type Lectura<T> = { ambito: string; datos: T } | { ambito: string; error: true }

// Lectura en vivo de una tarjeta de Inicio. Cada resultado queda atado a su ÁMBITO (organización +
// revisión de la empresa activa de la barra superior, Principio VIII / FR-010): si el ámbito cambia, lo
// que había se descarta al instante y se vuelve a consultar; nunca se muestra el dato de la empresa
// anterior. «Última petición gana». Con `habilitado=false` no se consulta (FR-007).
export function useLecturaInicio<T>(leer: () => Promise<T>, { habilitado = true }: { habilitado?: boolean } = {}) {
  const { organizacionActiva } = useOrganizacionActiva()
  const revision = useSyncExternalStore(suscribirEmpresaActiva, revisionEmpresaActiva, revisionEmpresaActiva)
  const ambito = `${organizacionActiva?.id ?? ''}|${revision}`
  const [lectura, setLectura] = useState<Lectura<T> | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    let resultado: Lectura<T>
    try {
      resultado = { ambito, datos: await leer() }
    } catch (error) {
      console.error('No pudimos cargar un dato de Inicio.', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    if (peticion === ultimaPeticion.current) setLectura(resultado)
  }, [ambito, leer])

  useEffect(() => {
    if (habilitado) void cargar()
    else ultimaPeticion.current++
  }, [cargar, habilitado])

  const vigente = habilitado && lectura && lectura.ambito === ambito ? lectura : null
  return {
    cargando: habilitado && vigente === null,
    hayError: vigente !== null && 'error' in vigente,
    datos: vigente !== null && 'datos' in vigente ? vigente.datos : null,
    recargar: cargar,
  }
}
