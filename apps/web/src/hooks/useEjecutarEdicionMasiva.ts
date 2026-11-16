import { useCallback, useState } from 'react'
import { mensajeErrorEdicionMasiva } from '../lib/edicionMasiva'

// Ejecución de una acción masiva (F-CAT-12, FR-008): `enCurso` mientras corre (el botón se deshabilita),
// `error` con un mensaje claro si falla (la selección queda intacta) y el resultado si sale bien.
export function useEjecutarEdicionMasiva() {
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ejecutar = useCallback(async (accion: () => Promise<number>): Promise<number | null> => {
    setEnCurso(true)
    setError(null)
    try {
      return await accion()
    } catch (falla) {
      setError(mensajeErrorEdicionMasiva(falla))
      return null
    } finally {
      setEnCurso(false)
    }
  }, [])

  return { enCurso, error, ejecutar, limpiarError: useCallback(() => setError(null), []) }
}
