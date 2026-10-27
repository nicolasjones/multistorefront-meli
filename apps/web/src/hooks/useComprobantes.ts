import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FILTROS_VACIOS,
  listarComprobantes,
  listarOperadoresComprobantes,
  type FiltrosComprobantes,
  type PaginaComprobantes,
} from '../lib/ventasComprobantes'
import { listarFormasPago } from '../lib/ventas/formasPago'
import { listarFormasEnvio } from '../lib/ventas/formasEnvio'

// Listado de Comprobantes (F-VTA-09, MSF-346, FR-001…FR-005): búsqueda con espera, filtros, tienda y paginación en el
// servidor. «Última petición gana»: una respuesta vieja no pisa a la nueva. Al cambiar la tienda (que sigue a la
// empresa activa de la barra superior, Constitución VIII) vuelve a la página 1, descarta Operador/Pago/Envío (los ids
// son de la empresa anterior) y recarga todo: nunca quedan filas ni totales de la empresa previa.

export const TAMANO_PAGINA_COMPROBANTES = 12
export const ESPERA_BUSQUEDA_MS = 300

const PAGINA_VACIA: PaginaComprobantes = { comprobantes: [], total: 0 }

type FiltroEditable = 'estado' | 'pagoId' | 'envioId' | 'operadorId'

export function useComprobantes(empresaId: string) {
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [elegidos, setElegidos] = useState<Pick<FiltrosComprobantes, FiltroEditable>>({
    estado: FILTROS_VACIOS.estado, pagoId: FILTROS_VACIOS.pagoId, envioId: FILTROS_VACIOS.envioId, operadorId: FILTROS_VACIOS.operadorId,
  })
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<PaginaComprobantes>(PAGINA_VACIA)
  const [cargando, setCargando] = useState(true)
  const [primeraCarga, setPrimeraCarga] = useState(true)
  const [hayError, setHayError] = useState(false)
  const ultimaPeticion = useRef(0)

  // Cambio de tienda: se ajusta durante el render (patrón de React para estado derivado de una prop), sin efecto extra.
  const [empresaVista, setEmpresaVista] = useState(empresaId)
  if (empresaVista !== empresaId) {
    setEmpresaVista(empresaId)
    setPagina(1)
    setElegidos((previos) => ({ ...previos, pagoId: '', envioId: '', operadorId: '' }))
  }

  // La búsqueda espera a que se deje de tipear y vuelve a la primera página.
  useEffect(() => {
    if (texto === textoAplicado) return
    const espera = setTimeout(() => {
      setTextoAplicado(texto)
      setPagina(1)
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  const filtros: FiltrosComprobantes = { busqueda: textoAplicado, ...elegidos, empresaId }
  const { busqueda, estado, pagoId, envioId, operadorId } = filtros

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarComprobantes({ busqueda, estado, pagoId, envioId, operadorId, empresaId }, pagina, TAMANO_PAGINA_COMPROBANTES)
      if (peticion !== ultimaPeticion.current) return
      setDatos(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar los comprobantes.', error)
      setDatos(PAGINA_VACIA)
      setHayError(true)
    }
    setCargando(false)
    setPrimeraCarga(false)
  }, [busqueda, estado, pagoId, envioId, operadorId, empresaId, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Página fuera de rango (p. ej. se filtró estando en la última página): vuelve a la primera.
  useEffect(() => {
    if (!primeraCarga && !cargando && !hayError && datos.comprobantes.length === 0 && pagina > 1) setPagina(1)
  }, [primeraCarga, cargando, hayError, datos.comprobantes.length, pagina])

  const elegir = useCallback((filtro: FiltroEditable, valor: string) => {
    setElegidos((previos) => ({ ...previos, [filtro]: valor }))
    setPagina(1)
  }, [])

  const limpiar = useCallback(() => {
    setTexto('')
    setTextoAplicado('')
    setElegidos({ estado: '', pagoId: '', envioId: '', operadorId: '' })
    setPagina(1)
  }, [])

  return { texto, setTexto, filtros, elegir, limpiar, pagina, setPagina, datos, cargando, primeraCarga, hayError, recargar: cargar }
}

export type OpcionFiltro = { id: string; nombre: string }

// Opciones de Operador, Pago y Envío acotadas a la tienda elegida (o a todas las accesibles). Pago y Envío son
// catálogos por empresa (MSF-139): con varias tiendas en juego el nombre lleva la tienda para distinguirlas.
export function useOpcionesFiltrosComprobantes(empresaId: string, empresas: ReadonlyArray<{ id: string; nombre: string }>) {
  const [opciones, setOpciones] = useState<{ operadores: OpcionFiltro[]; pagos: OpcionFiltro[]; envios: OpcionFiltro[] }>({ operadores: [], pagos: [], envios: [] })
  const [hayError, setHayError] = useState(false)
  const claveEmpresas = empresas.map((e) => e.id).join(',')

  useEffect(() => {
    let vigente = true
    const alcance = empresaId === '' ? empresas : empresas.filter((e) => e.id === empresaId)
    const conTienda = alcance.length > 1
    const nombreDe = (nombre: string, tienda: string) => (conTienda ? `${nombre} · ${tienda}` : nombre)
    void (async () => {
      try {
        const [operadores, pagos, envios] = await Promise.all([
          listarOperadoresComprobantes(empresaId),
          Promise.all(alcance.map(async (e) => (await listarFormasPago(e.id)).map((f) => ({ id: f.id, nombre: nombreDe(f.nombre, e.nombre) })))),
          Promise.all(alcance.map(async (e) => (await listarFormasEnvio(e.id)).map((f) => ({ id: f.id, nombre: nombreDe(f.nombre, e.nombre) })))),
        ])
        if (!vigente) return
        setOpciones({ operadores, pagos: pagos.flat(), envios: envios.flat() })
        setHayError(false)
      } catch (error) {
        if (!vigente) return
        console.error('No pudimos cargar las opciones de los filtros.', error)
        setOpciones({ operadores: [], pagos: [], envios: [] })
        setHayError(true)
      }
    })()
    return () => {
      vigente = false
    }
    // `empresas` se compara por sus ids (claveEmpresas): la lista llega como un arreglo nuevo en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, claveEmpresas])

  return { ...opciones, hayError }
}
