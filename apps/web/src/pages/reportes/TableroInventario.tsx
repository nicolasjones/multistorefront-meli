import { useState } from 'react'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { SECCION_INVENTARIO } from '../../lib/reportes-inventario'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

type Props = {
  // Nombre del reporte en `public.reportes`: identifica el tablero embebido.
  nombreReporte: string
  // Etiqueta del reporte para los mensajes de la pantalla («Productos y stock»).
  etiquetaReporte: string
}

// Tablero embebido de un reporte de inventario con los estados compartidos del panel: carga, error
// con «Reintentar» y acceso restringido ante un 403 del token. El inventario es por organización, así
// que no hay filtro de empresa (Principio VIII, no aplica; ver matriz de la spec). La ruta va
// envuelta en RequiereAccesoSeccion (`stock` ≥ lectura): sin la sección no se monta nada ni se pide
// token. El estado vacío lo dibuja el propio tablero (tabla sin filas).
export function TableroInventario({ nombreReporte, etiquetaReporte }: Props) {
  const { reportes, isLoading } = useReportesAsignados()
  // Cada intento remonta el tablero: repite la solicitud del token y el montaje.
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  const reporte = reportes.find((candidato) => candidato.nombre === nombreReporte)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }

  if (fallo === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Stock" seccionClave={SECCION_INVENTARIO} />
  }

  let tablero
  if (isLoading) tablero = <EstadoCargaPagina />
  else if (!reporte) {
    tablero = <EstadoError descripcion={`El tablero de «${etiquetaReporte}» todavía no está disponible para tu organización.`} />
  } else if (fallo === 'no_disponible') {
    tablero = <EstadoError descripcion={`No pudimos cargar el tablero de «${etiquetaReporte}».`} reintentar={reintentar} />
  } else {
    tablero = <ReporteEmbebido key={`${reporte.id}-${intento}`} reporteId={reporte.id} alFallar={setFallo} />
  }

  return <ContenedorSeccion>{tablero}</ContenedorSeccion>
}
