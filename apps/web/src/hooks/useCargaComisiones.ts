import { useCallback, useEffect, useRef, useState } from 'react'
import { mensajeDeErrorComisiones } from '../lib/comisiones'

type Estado<T> = { datos: T | null; cargando: boolean; error: string | null; recargar: () => void }

// Carga de una consulta de comisiones que depende de un período. Solo la última solicitud pisa el estado (cambiar de mes
// rápido no deja datos viejos) y, al cambiar `clave` (período, técnico), se descarta lo cargado antes de pedir de nuevo:
// nunca se muestra un total de otro mes.
export function useCargaComisiones<T>(clave: string, cargar: () => Promise<T>, mensajeError: string): Estado<T> {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const ultima = useRef(0)
  const cargarRef = useRef(cargar)
  cargarRef.current = cargar

  useEffect(() => {
    const pedido = ++ultima.current
    setDatos(null)
    setCargando(true)
    setError(null)
    cargarRef.current().then(
      (resultado) => {
        if (pedido !== ultima.current) return
        setDatos(resultado)
        setCargando(false)
      },
      (falla) => {
        if (pedido !== ultima.current) return
        setError(mensajeDeErrorComisiones(falla, mensajeError))
        setCargando(false)
      },
    )
    return () => { ultima.current += 1 }
  }, [clave, version, mensajeError])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])
  return { datos, cargando, error, recargar }
}
