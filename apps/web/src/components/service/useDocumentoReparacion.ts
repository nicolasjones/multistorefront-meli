import { useCallback, useEffect, useState } from 'react'
import { listarTecnicos, mensajeDeErrorReparacion, obtenerReparacion, type Reparacion } from '../../lib/reparaciones'
import { obtenerDatosTienda, type DatosTienda } from '../../lib/documentosReparacion'

export type DatosDocumento = { reparacion: Reparacion; tienda: DatosTienda; tecnico: string | null }

// Carga lo que necesita un documento imprimible (F-SVC-07, FR-046): solo lectura —`obtener_reparacion`, la tienda y
// el nombre del técnico—. Si cambia el id descarta la respuesta tardía de la anterior. El técnico es accesorio: si no
// se puede resolver, el documento sale igual sin ese dato.
export function useDocumentoReparacion(id: string | undefined) {
  const [datos, setDatos] = useState<DatosDocumento | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError(null)
    setDatos(null)
    async function cargar() {
      try {
        if (!id) throw new Error('Reparación no encontrada.')
        const reparacion = await obtenerReparacion(id)
        const [tienda, tecnicos] = await Promise.all([
          obtenerDatosTienda(reparacion.empresa_id),
          listarTecnicos().catch(() => []),
        ])
        const tecnico = tecnicos.find((t) => t.user_id === reparacion.tecnico_id)?.nombre ?? null
        if (vigente) setDatos({ reparacion, tienda, tecnico })
      } catch (excepcion) {
        if (vigente) setError(mensajeDeErrorReparacion(excepcion, 'No pudimos cargar el documento.'))
      } finally {
        if (vigente) setCargando(false)
      }
    }
    void cargar()
    return () => {
      vigente = false
    }
  }, [id, intento])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  return { datos, error, cargando, reintentar }
}
