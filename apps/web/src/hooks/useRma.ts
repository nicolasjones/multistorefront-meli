import { useCallback, useEffect, useRef, useState } from 'react'
import { FILTROS_RMA_VACIOS, listarRma, TAMANO_PAGINA_RMA, type PaginaRma } from '../lib/rma'

// Listado de Devoluciones (F-VTA-28, MSF-288, FR-007, FR-008): tienda y paginación en el servidor. «Última petición
// gana»: una respuesta vieja no pisa a la nueva. Al cambiar la tienda (que sigue a la empresa activa de la barra
// superior, Constitución VIII) vuelve a la página 1 y recarga todo: nunca quedan filas ni totales de la empresa previa.

const PAGINA_VACIA: PaginaRma = { devoluciones: [], total: 0 }

export function useRma(empresaId: string) {
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<PaginaRma>(PAGINA_VACIA)
  const [cargando, setCargando] = useState(true)
  const [primeraCarga, setPrimeraCarga] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  // Cambio de tienda: se ajusta durante el render (patrón de React para estado derivado de una prop), sin efecto extra.
  const [empresaVista, setEmpresaVista] = useState(empresaId)
  if (empresaVista !== empresaId) {
    setEmpresaVista(empresaId)
    setPagina(1)
  }

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarRma({ ...FILTROS_RMA_VACIOS, empresaId }, pagina, TAMANO_PAGINA_RMA)
      if (peticion !== ultimaPeticion.current) return
      setDatos(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar las devoluciones.', error)
      setDatos(PAGINA_VACIA)
      setHayError(true)
    }
    setCargando(false)
    setPrimeraCarga(false)
  }, [empresaId, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Página fuera de rango (p. ej. se vació la última página): vuelve a la primera.
  useEffect(() => {
    if (!primeraCarga && !cargando && !hayError && datos.devoluciones.length === 0 && pagina > 1) setPagina(1)
  }, [primeraCarga, cargando, hayError, datos.devoluciones.length, pagina])

  return { pagina, setPagina, datos, cargando, primeraCarga, hayError, recargar: cargar }
}
