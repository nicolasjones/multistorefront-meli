import { useCallback, useEffect, useRef, useState } from 'react'
import { supabaseClient } from '../lib/supabase'
import type { FiltrosActividad } from '../lib/actividad'
import { descargarCsvActividad, TOPE_FILAS_ACTIVIDAD, traerActividadParaExportar } from '../lib/exportarActividad'
import type { MensajeExportacion } from './useExportarCsv'

// Exportar la actividad (F-AUD-03, FR-013): respeta todos los filtros de la pantalla y la empresa activa
// (ya vienen en `filtros.empresa`). «Exportando…» mientras corre, error con reintento, aviso si no hay
// nada y, si el filtro supera el tope, un aviso que pide acotar sin descargar. Si la empresa activa cambia a mitad de la exportación se descarta lo traído:
// nunca se baja un archivo de otra empresa (Principio VIII).
export function useExportarActividad(filtros: FiltrosActividad) {
  const [exportando, setExportando] = useState(false)
  // El aviso recuerda con qué empresa se generó: si cambia la empresa activa deja de mostrarse (se deriva al leer).
  const [aviso, setAviso] = useState<{ mensaje: MensajeExportacion; empresa: string | null } | null>(null)
  const enCurso = useRef(false)
  const montado = useRef(true)
  const generacion = useRef(0)

  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])

  // Cambiar de empresa invalida la exportación en curso.
  useEffect(() => {
    generacion.current += 1
  }, [filtros.empresa])

  const empresa = filtros.empresa
  const setMensaje = useCallback(
    (mensaje: MensajeExportacion | null) => setAviso(mensaje ? { mensaje, empresa } : null),
    [empresa],
  )

  const exportar = useCallback(async () => {
    if (enCurso.current) return
    enCurso.current = true
    const miGeneracion = generacion.current
    setExportando(true)
    setMensaje(null)
    try {
      const resultado = await traerActividadParaExportar(supabaseClient, filtros)
      if (!montado.current || miGeneracion !== generacion.current) return
      if (resultado.estado === 'vacio') {
        setMensaje({ tipo: 'aviso', texto: 'No hay actividad para exportar.' })
        return
      }
      if (resultado.estado === 'excede') {
        // CA-AUD-03-3: no se baja un archivo recortado; el aviso queda hasta que se cierre.
        setMensaje({
          tipo: 'aviso',
          texto: `El filtro tiene ${resultado.total.toLocaleString('es-AR')} filas y el máximo por archivo es ${TOPE_FILAS_ACTIVIDAD.toLocaleString('es-AR')}. No se descargó ningún archivo: acotá el período o los filtros y exportá de nuevo.`,
        })
        return
      }
      descargarCsvActividad(resultado.filas)
    } catch (error) {
      console.error('No pudimos exportar la actividad.', error)
      if (montado.current && miGeneracion === generacion.current) {
        setMensaje({ tipo: 'error', texto: 'No pudimos exportar. No se descargó ningún archivo; intentá de nuevo.' })
      }
    } finally {
      enCurso.current = false
      if (montado.current) setExportando(false)
    }
  }, [filtros, setMensaje])

  const cerrarMensaje = useCallback(() => setMensaje(null), [setMensaje])
  const mensaje = aviso && aviso.empresa === filtros.empresa ? aviso.mensaje : null

  return { exportar, exportando, mensaje, cerrarMensaje }
}
