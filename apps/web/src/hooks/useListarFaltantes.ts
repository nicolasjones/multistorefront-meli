import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  avisarFaltantesVenta,
  listarFaltantes,
  type AvisoFaltante,
  type FaltanteVenta,
  type ResultadoAvisoVenta,
} from '../lib/ventasFaltantes'
import { useOrganizacionActiva } from './useOrganizacionActiva'

export type FiltrosFaltantes = {
  // Id de la tienda por la que filtrar; null = todas.
  empresaId: string | null
  pagina: number
  tamano: number
  // Filtro por aviso (F-VTA-27: `para_avisar`); sin valor se listan todos.
  aviso?: AvisoFaltante | null
}

// Cada lectura queda atada a su ÁMBITO (organización + tienda) y a su filtro de aviso: si cambia, lo que
// había se descarta de inmediato y nunca se muestran filas ni totales de la empresa anterior (Principio
// VIII, FR-046). «Última petición gana»: una respuesta vieja no pisa a la nueva. Mientras llega la
// siguiente página se conservan las filas anteriores (`isFetching`); `isLoading` es solo la primera carga
// o el cambio de ámbito, para no parpadear.
//
// La SELECCIÓN (F-VTA-26) va atada al ámbito Y al filtro de aviso (MSF-161 m-7/QA M4): al cambiar de empresa o
// de filtro se descarta sola, así el contador «Avisar (n)» y el envío solo cuentan lo que se ve y nunca se avisa
// a clientes de otra tienda (FR-009) ni a filas fuera de pantalla. Guarda por faltante el cliente (el
// diálogo cuenta clientes) y si ya estaba avisado (el diálogo pide confirmar el reaviso).
type Lectura = { clave: string; faltantes: FaltanteVenta[]; total: number } | { clave: string; error: true }
export type ElegidoFaltante = { cliente: string; avisado: boolean }
type Seleccion = { ambito: string; items: Record<string, ElegidoFaltante> }

const SIN_FILAS: FaltanteVenta[] = []

export function useListarFaltantes({ empresaId, pagina, tamano, aviso = null }: FiltrosFaltantes) {
  const [lectura, setLectura] = useState<Lectura | null>(null)
  const [cargando, setCargando] = useState(true)
  const [seleccion, setSeleccion] = useState<Seleccion>({ ambito: '', items: {} })
  const { organizacionActiva } = useOrganizacionActiva()
  const organizacionId = organizacionActiva?.id ?? null
  const ambito = `${organizacionId ?? ''}|${empresaId ?? 'todas'}`
  const clave = `${ambito}|${aviso ?? 'todos'}`
  const ultimaPeticion = useRef(0)

  // Al cambiar de ámbito la selección se DESCARTA y no vuelve a armarse sola (FR-009): si reapareciera al
  // volver a la empresa anterior, el botón «Avisar» se activaría con filas que la persona ya no eligió. Se
  // ajusta en el render (no en un efecto) para que no se dibuje ni un cuadro con la selección anterior.
  const [claveSeleccion, setClaveSeleccion] = useState(clave)
  if (clave !== claveSeleccion) {
    setClaveSeleccion(clave)
    setSeleccion({ ambito: clave, items: {} })
  }

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura
    try {
      resultado = { clave, ...(await listarFaltantes({ empresaId, pagina, tamano, ...(aviso ? { aviso } : {}) })) }
    } catch (excepcion) {
      console.error('No pudimos listar los faltantes.', excepcion)
      resultado = { clave, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
    // organizacionId solo dispara la recarga; RLS resuelve la organización.
  }, [clave, empresaId, pagina, tamano, aviso])

  // La recarga que sigue a un aviso usa los filtros VIGENTES, no los del momento del clic: si la persona
  // cambió de página o de empresa mientras el aviso viajaba, pide lo que está a la vista.
  const cargarVigente = useRef(cargar)
  useEffect(() => {
    cargarVigente.current = cargar
  }, [cargar])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Solo vale lo que llegó para el ámbito vigente: al cambiar de tienda (barra superior o filtro) no
  // se dibuja ni una fila de la empresa anterior.
  const vigente = lectura !== null && lectura.clave === clave

  // Solo valen las filas elegidas en ESTE ámbito.
  const elegidos = useMemo(() => (seleccion.ambito === clave ? seleccion.items : {}), [seleccion, clave])

  const alternar = useCallback(
    (fila: FaltanteVenta) => {
      setSeleccion((actual) => {
        const items = { ...(actual.ambito === clave ? actual.items : {}) }
        if (items[fila.id]) delete items[fila.id]
        else items[fila.id] = { cliente: fila.cliente, avisado: fila.aviso === 'avisado' }
        return { ambito: clave, items }
      })
    },
    [clave],
  )

  // `filas`: las que están a la vista (con carga infinita son las de todas las tandas cargadas).
  const alternarTodos = useCallback(
    (filas: readonly FaltanteVenta[]) => {
      setSeleccion((actual) => {
        const items = { ...(actual.ambito === clave ? actual.items : {}) }
        const todos = filas.length > 0 && filas.every((fila) => items[fila.id])
        for (const fila of filas) {
          if (todos) delete items[fila.id]
          else items[fila.id] = { cliente: fila.cliente, avisado: fila.aviso === 'avisado' }
        }
        return { ambito: clave, items }
      })
    },
    [clave],
  )

  const limpiar = useCallback(() => setSeleccion({ ambito: clave, items: {} }), [clave])

  // Avisa los faltantes elegidos, descarta la selección y recarga para verlos «Avisado». Si la RPC falla,
  // no limpia ni recarga (la persona puede reintentar con lo mismo).
  const avisar = useCallback(
    async (mensaje: string, reavisar: boolean): Promise<ResultadoAvisoVenta> => {
      const resultado = await avisarFaltantesVenta(Object.keys(elegidos), mensaje, reavisar)
      setSeleccion({ ambito: clave, items: {} })
      await cargarVigente.current()
      return resultado
    },
    [clave, elegidos],
  )

  return {
    ambito,
    faltantes: vigente && 'faltantes' in lectura ? lectura.faltantes : SIN_FILAS,
    total: vigente && 'faltantes' in lectura ? lectura.total : 0,
    isLoading: !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
    elegidos,
    alternar,
    alternarTodos,
    limpiar,
    avisar,
  }
}
