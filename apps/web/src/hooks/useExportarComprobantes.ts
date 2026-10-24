import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  descargarArchivo,
  exportarInmediato,
  nombreArchivoComprobantes,
  solicitarExportacionDiferida,
  viaDeExportacion,
  type TipoExportacion,
} from '../lib/exportarComprobantes'
import type { FiltrosComprobantes } from '../lib/ventasComprobantes'

// Exportación de Comprobantes y Presupuestos (F-VTA-09, MSF-346, FR-006/FR-010): elige la vía según el
// total del filtro, arma/descarga el CSV en el navegador hasta 10.000 filas o registra la solicitud
// diferida por encima, y deja un aviso listo para el kit de estados. Los filtros se toman como foto al
// pulsar: si la persona cambia la pantalla mientras exporta, el archivo conserva el pedido original.

export type AvisoExportacion = {
  severidad: 'success' | 'info' | 'error'
  texto: string
  enlace?: { to: string; texto: ReactNode }
}

export function useExportarComprobantes(tipo: TipoExportacion, filtros: FiltrosComprobantes, total: number) {
  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<AvisoExportacion | null>(null)

  async function exportar() {
    const via = viaDeExportacion(total)
    if (via === 'vacia') {
      setAviso({ severidad: 'info', texto: 'Sin resultados: no hay filas para exportar con estos filtros.' })
      return
    }
    setExportando(true)
    setAviso(null)
    try {
      if (via === 'inmediata') {
        const { archivo, filas } = await exportarInmediato(tipo, filtros)
        if (filas === 0) {
          setAviso({ severidad: 'info', texto: 'Sin resultados: no hay filas para exportar con estos filtros.' })
          return
        }
        descargarArchivo(archivo, nombreArchivoComprobantes(tipo))
        setAviso({ severidad: 'success', texto: 'Exportación lista: el archivo se descargó.' })
        return
      }
      const ejecucionId = await solicitarExportacionDiferida(tipo, filtros)
      setAviso({
        severidad: 'success',
        texto: 'Exportación solicitada: el archivo va a estar disponible en Ejecuciones cuando termine.',
        enlace: { to: `/ejecuciones/${ejecucionId}`, texto: 'Ver en Ejecuciones' },
      })
    } catch (error) {
      setAviso({
        severidad: 'error',
        texto: error instanceof Error && error.message ? error.message : 'No pudimos exportar. Probá de nuevo.',
      })
    } finally {
      setExportando(false)
    }
  }

  return { exportando, exportar, aviso, cerrarAviso: () => setAviso(null) }
}
