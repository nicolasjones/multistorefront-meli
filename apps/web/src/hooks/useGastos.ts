import { useCallback, useEffect, useRef, useState } from 'react'
import { type FiltrosGastos, type Gasto, type ResumenGastos, TAMANO_TANDA_GASTOS, listarGastos, resumenGastos } from '../lib/gastos'

// Listado de gastos con carga infinita por cursor (fecha desc, id) y su resumen (F-GAS-02). Cambiar cualquier filtro, el período o
// «Mostrar anulados» reinicia la lista desde la primera tanda; «última petición gana».
export function useGastos(filtros: FiltrosGastos, incluirAnulados: boolean) {
  const [filas, setFilas] = useState<Gasto[]>([])
  const [resumen, setResumen] = useState<ResumenGastos | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [hayError, setHayError] = useState(false)
  const [errorTanda, setErrorTanda] = useState(false)
  const peticion = useRef(0)
  const ultima = useRef<Gasto | null>(null)
  const clave = JSON.stringify([filtros, incluirAnulados])

  const recargar = useCallback(async () => {
    const f = JSON.parse(clave)[0] as FiltrosGastos
    const inc = JSON.parse(clave)[1] as boolean
    const numero = ++peticion.current
    setCargando(true)
    setHayError(false)
    setErrorTanda(false)
    try {
      const [tanda, res] = await Promise.all([listarGastos(f, inc, null), resumenGastos(f)])
      if (numero !== peticion.current) return
      setFilas(tanda)
      setResumen(res)
      setHayMas(tanda.length === TAMANO_TANDA_GASTOS)
      ultima.current = tanda[tanda.length - 1] ?? null
    } catch {
      if (numero !== peticion.current) return
      setFilas([])
      setResumen(null)
      setHayMas(false)
      setHayError(true)
    } finally {
      if (numero === peticion.current) setCargando(false)
    }
  }, [clave])

  useEffect(() => {
    void recargar()
    const actual = peticion
    return () => { actual.current += 1 }
  }, [recargar])

  const cargarMas = useCallback(async () => {
    const cursor = ultima.current
    if (!cursor || cargando || cargandoMas) return
    const f = JSON.parse(clave)[0] as FiltrosGastos
    const inc = JSON.parse(clave)[1] as boolean
    const numero = peticion.current
    setCargandoMas(true)
    setErrorTanda(false)
    try {
      const tanda = await listarGastos(f, inc, { fecha: cursor.fecha, id: cursor.id })
      if (numero !== peticion.current) return
      setFilas((actuales) => [...actuales, ...tanda])
      setHayMas(tanda.length === TAMANO_TANDA_GASTOS)
      ultima.current = tanda[tanda.length - 1] ?? cursor
    } catch {
      if (numero !== peticion.current) return
      setErrorTanda(true)
    } finally {
      if (numero === peticion.current) setCargandoMas(false)
    }
  }, [clave, cargando, cargandoMas])

  return { filas, resumen, hayMas, cargando, cargandoMas, hayError, errorTanda, recargar, cargarMas }
}
