import { useCallback, useEffect, useRef, useState } from 'react'
import { armarCsv, descargarCsv, TOPE_FILAS_EXPORTACION, type ColumnaCsv } from '../lib/exportarCsv'

export type MensajeExportacion = { tipo: 'aviso' | 'error'; texto: string }

type Entrada<T> = {
  columnas: readonly ColumnaCsv<T>[]
  nombreArchivo: () => string
  tamanoLote: number
  // Pide un lote de la misma consulta que la pantalla (mismos filtros, sin paginar).
  pedirLote: (desde: number, limite: number) => Promise<T[]>
  // Opcional: completa cada lote con datos que la pantalla trae aparte (p. ej. cifras por depósito).
  completarLote?: (lote: T[]) => Promise<T[]>
  // Opcional: se llama al empezar cada exportación, para descartar lo que dejó la anterior.
  iniciar?: () => void
  // Opcional: identifica una fila; si se repite entre lotes (paginación por desplazamiento sobre datos que cambian)
  // se exporta una sola vez.
  clave?: (fila: T) => string
}

// Exportación a CSV de lo que muestra una pantalla (F-STK-08, FR-107): pide todo por lotes,
// con tope de filas y aviso; si algo falla no se descarga nada (nunca un archivo parcial).
export function useExportarCsv<T>({ columnas, nombreArchivo, tamanoLote, pedirLote, completarLote, iniciar, clave }: Entrada<T>) {
  const [exportando, setExportando] = useState(false)
  const [mensaje, setMensaje] = useState<MensajeExportacion | null>(null)
  const enCurso = useRef(false)
  const montado = useRef(true)

  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])

  const exportar = useCallback(async () => {
    if (enCurso.current) return
    enCurso.current = true
    setExportando(true)
    setMensaje(null)
    iniciar?.()
    try {
      const filas: T[] = []
      const vistas = new Set<string>()
      let truncado = false
      // Filas ya pedidas al servidor (con duplicados): es el desplazamiento del lote siguiente.
      let pedidas = 0
      for (;;) {
        const lote = await pedirLote(pedidas, tamanoLote)
        pedidas += lote.length
        for (const fila of completarLote ? await completarLote(lote) : lote) {
          const id = clave?.(fila)
          if (id !== undefined) {
            if (vistas.has(id)) continue
            vistas.add(id)
          }
          // Llegó una fila MÁS allá del tope: ahora sí hay truncado (con exactamente el tope no hay aviso falso).
          if (filas.length >= TOPE_FILAS_EXPORTACION) { truncado = true; break }
          filas.push(fila)
        }
        if (truncado || lote.length < tamanoLote) break
      }
      descargarCsv(armarCsv(columnas, filas), nombreArchivo())
      if (!montado.current) return
      if (filas.length === 0) setMensaje({ tipo: 'aviso', texto: 'No hay filas para exportar. El archivo trae solo los encabezados.' })
      else if (truncado) {
        setMensaje({
          tipo: 'aviso',
          texto: `Se exportaron las primeras ${TOPE_FILAS_EXPORTACION.toLocaleString('es-AR')} filas. Afiná los filtros para exportar el resto.`,
        })
      }
    } catch (error) {
      console.error('No pudimos exportar a CSV.', error)
      if (montado.current) setMensaje({ tipo: 'error', texto: 'No pudimos exportar. No se descargó ningún archivo; intentá de nuevo.' })
    } finally {
      enCurso.current = false
      if (montado.current) setExportando(false)
    }
  }, [columnas, nombreArchivo, tamanoLote, pedirLote, completarLote, iniciar, clave])

  const cerrarMensaje = useCallback(() => setMensaje(null), [])

  return { exportar, exportando, mensaje, cerrarMensaje }
}
