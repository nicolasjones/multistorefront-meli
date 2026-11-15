import { useCallback, useEffect, useRef, useState } from 'react'
import {
  leerContacto,
  leerHistorial,
  listarContactos,
  type Contacto,
  type EntradaHistorial,
  type FichaContacto,
  type FiltrosContactos,
} from '../lib/contactos'
import { useEmpresasAccesibles } from './useEmpresasAccesibles'
import { useOrganizacionActiva } from './useOrganizacionActiva'

// Las lecturas de la libreta comparten dos reglas (Principio VIII, FR-012):
//  * «Última petición gana»: una respuesta vieja no pisa a la nueva.
//  * Cada resultado queda atado a su ÁMBITO (organización + empresa/ficha): si el ámbito cambia
//    (otra empresa activa en la barra superior), lo que había se descarta de inmediato y nunca se
//    muestran filas ni totales de la empresa anterior.
type Lectura<T> = { ambito: string; datos: T } | { ambito: string; error: true }

export function useLibretaContactos(filtros: FiltrosContactos, { habilitado = true }: { habilitado?: boolean } = {}) {
  const { organizacionActiva } = useOrganizacionActiva()
  const ambito = `${organizacionActiva?.id ?? ''}|${filtros.empresaId ?? 'todas'}`
  const [lectura, setLectura] = useState<Lectura<{ filas: Contacto[]; total: number }> | null>(null)
  const [cargando, setCargando] = useState(false)
  const ultimaPeticion = useRef(0)
  const { empresaId, texto, pagina, tamano } = filtros

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    let resultado: Lectura<{ filas: Contacto[]; total: number }>
    try {
      resultado = { ambito, datos: await listarContactos({ empresaId, texto, pagina, tamano }) }
    } catch (error) {
      console.error('No se pudo cargar la libreta de contactos', error instanceof Error ? error.message : error)
      resultado = { ambito, error: true }
    }
    if (peticion !== ultimaPeticion.current) return
    setLectura(resultado)
    setCargando(false)
  }, [ambito, empresaId, texto, pagina, tamano])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  const vigente = lectura !== null && lectura.ambito === ambito
  const datos = vigente && 'datos' in lectura ? lectura.datos : null
  return {
    contactos: datos?.filas ?? [],
    total: datos?.total ?? 0,
    isLoading: !habilitado || !vigente,
    isFetching: cargando,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}

// La ficha y su historial se leen frescos al abrir: `updated_at` es el sello del bloqueo optimista.
// `noEncontrado` cubre inexistente y sin acceso por igual.
export function useFichaContacto(id: string | null) {
  const { organizacionActiva } = useOrganizacionActiva()
  const clave = `${organizacionActiva?.id ?? ''}|${id ?? ''}`
  const [lectura, setLectura] = useState<Lectura<FichaContacto | null> | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!id) return
    const peticion = ++ultimaPeticion.current
    let resultado: Lectura<FichaContacto | null>
    try {
      resultado = { ambito: clave, datos: await leerContacto(id) }
    } catch (error) {
      console.error('No se pudo cargar el contacto', error instanceof Error ? error.message : error)
      resultado = { ambito: clave, error: true }
    }
    if (peticion === ultimaPeticion.current) setLectura(resultado)
  }, [id, clave])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = id !== null && lectura !== null && lectura.ambito === clave
  const datos = vigente && 'datos' in lectura ? lectura.datos : null
  return {
    ficha: datos,
    isLoading: id !== null && !vigente,
    isError: vigente && 'error' in lectura,
    noEncontrado: vigente && 'datos' in lectura && lectura.datos === null,
    refetch: cargar,
  }
}

export function useHistorialContacto(id: string | null) {
  const { organizacionActiva } = useOrganizacionActiva()
  const clave = `${organizacionActiva?.id ?? ''}|${id ?? ''}`
  const [lectura, setLectura] = useState<Lectura<EntradaHistorial[]> | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!id) return
    const peticion = ++ultimaPeticion.current
    let resultado: Lectura<EntradaHistorial[]>
    try {
      resultado = { ambito: clave, datos: await leerHistorial(id) }
    } catch (error) {
      console.error('No se pudo cargar el historial del contacto', error instanceof Error ? error.message : error)
      resultado = { ambito: clave, error: true }
    }
    if (peticion === ultimaPeticion.current) setLectura(resultado)
  }, [id, clave])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const vigente = id !== null && lectura !== null && lectura.ambito === clave
  return {
    historial: vigente && 'datos' in lectura ? lectura.datos : [],
    isLoading: id !== null && !vigente,
    isError: vigente && 'error' in lectura,
    refetch: cargar,
  }
}

// ¿Cambió la empresa activa de la barra superior desde que se montó quien lo usa? (Principio VIII).
// Diálogos y ficha lo usan para cerrarse con aviso en vez de guardar datos de la empresa anterior bajo
// la nueva. La base es la primera empresa activa resuelta, así la carga inicial no cuenta como cambio.
export function useEmpresaActivaCambio(): boolean {
  const { empresas, empresaActivaId } = useEmpresasAccesibles()
  const [base, setBase] = useState<{ id: string | null } | null>(null)
  if (base === null && empresas.length > 0) setBase({ id: empresaActivaId })
  return base !== null && base.id !== empresaActivaId
}

export const AVISO_CAMBIO_EMPRESA = 'Cambiaste de empresa: cerramos lo que estabas haciendo para no mezclar datos de dos tiendas.'
