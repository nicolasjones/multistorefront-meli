import { useState } from 'react'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { useConteoVentasReporte } from '../../hooks/useVentasReportes'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MENSAJE_SIN_VENTAS, SECCION_REPORTES, type RangoFechas } from '../../lib/ventas-reportes'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'

type FalloReporte = { motivo: MotivoFalloReporte; clave: string }

// El fallo de carga ('no_disponible') solo vale para los filtros con los que ocurrió: si cambian, el
// tablero se vuelve a montar con los nuevos (si no, se seguiría viendo el error anterior hasta apretar
// «Reintentar»). El acceso restringido ('prohibido') no depende de los filtros: se mantiene.
function falloVigente(fallo: FalloReporte | null, clave: string): MotivoFalloReporte | null {
  if (fallo === null) return null
  if (fallo.motivo === 'prohibido') return fallo.motivo
  return fallo.clave === clave ? fallo.motivo : null
}

type Props = {
  rango: RangoFechas
  empresaId: string | null
  // El filtro de empresa todavía está cargando: no se monta el tablero hasta saber la tienda
  // (si no, se pediría el token dos veces: una sin filtro y otra con la tienda activa).
  cargandoEmpresa: boolean
  // Nombre del reporte en `public.reportes`: identifica el tablero embebido.
  nombreReporte: string
  // Etiqueta del reporte para los mensajes de la pantalla («Más vendidos», «Ranking de clientes»).
  etiquetaReporte: string
  // Filtros nativos preseleccionados en el tablero (rison). Si cambian, el tablero se remonta con
  // los filtros nuevos (la clave de montaje los incluye).
  urlParams: Record<string, string>
  // Fuente del conteo del período y texto del estado vacío. Por defecto, las ventas.
  leerConteo?: (cliente: SupabaseClient, filtros: { rango: RangoFechas; empresaId: string | null }) => Promise<number>
  mensajeVacio?: string
}

// Tablero embebido de una pestaña de «Reportes de ventas» con los estados compartidos del panel:
// carga, vacío («No hay ventas en ese período»), error con «Reintentar» y acceso restringido ante un
// 403 del token. Lo usan las dos pestañas («Más vendidos» de F-VTA-22 y «Ranking de clientes» de
// F-VTA-23): el marco, el filtro por empresa y los filtros de período son los mismos.
export function TableroReporte({
  rango,
  empresaId,
  cargandoEmpresa,
  nombreReporte,
  etiquetaReporte,
  urlParams,
  leerConteo,
  mensajeVacio = MENSAJE_SIN_VENTAS,
}: Props) {
  const { reportes, isLoading: cargandoReportes } = useReportesAsignados()
  const { conteo, hayError, isLoading: cargandoConteo } = useConteoVentasReporte({
    rango,
    empresaId,
    habilitado: !cargandoEmpresa,
    leerConteo,
  })
  // Cada intento remonta el tablero: repite la solicitud del token y el montaje.
  const [intento, setIntento] = useState(0)
  // El fallo se guarda con los filtros con los que ocurrió (ver `falloVigente`).
  const [fallo, setFallo] = useState<FalloReporte | null>(null)
  const claveFiltros = `${rango.desde}|${rango.hasta}|${empresaId ?? 'todas'}`
  // Al cambiar los filtros se descarta el fallo de carga: el error de un período anterior no puede
  // reaparecer cuando se vuelve a ese período. Es el patrón de React para ajustar el estado cuando
  // cambia una prop (el ajuste va en el render, no en un efecto). El acceso restringido ('prohibido')
  // no depende de los filtros: se mantiene.
  const [claveVista, setClaveVista] = useState(claveFiltros)
  if (claveVista !== claveFiltros) {
    setClaveVista(claveFiltros)
    if (fallo?.motivo === 'no_disponible') setFallo(null)
  }
  const falloActual = falloVigente(fallo, claveFiltros)

  const reporte = reportes.find((candidato) => candidato.nombre === nombreReporte)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }

  if (falloActual === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Reportes de ventas" seccionClave={SECCION_REPORTES} />
  }

  let tablero
  // El conteo del período todavía no llegó: el tablero no se monta todavía. Si se montara, el
  // embebido pediría el token del guest al montar y el tablero se volvería a montar al llegar el
  // conteo: dos pedidos de token por cada carga de pantalla.
  if (cargandoReportes || cargandoConteo || cargandoEmpresa || (conteo === null && !hayError)) {
    tablero = <EstadoCargaPagina />
  } else if (conteo === 0) {
    tablero = (
      <EstadoVacio
        titulo={mensajeVacio}
        descripcion="Probá con otro período o con otra tienda."
      />
    )
  } else if (!reporte) {
    tablero = <EstadoError descripcion={`El tablero de «${etiquetaReporte}» todavía no está disponible para tu organización.`} />
  } else if (falloActual === 'no_disponible') {
    tablero = <EstadoError descripcion={`No pudimos cargar el tablero de «${etiquetaReporte}».`} reintentar={reintentar} />
  } else {
    tablero = (
      <ReporteEmbebido
        // La clave incluye los filtros preseleccionados: si cambian (período, tienda o el
        // interruptor «Consumidor final»), el tablero se remonta con los nuevos.
        key={`${reporte.id}-${JSON.stringify(urlParams)}-${intento}`}
        reporteId={reporte.id}
        alFallar={(motivo) => setFallo({ motivo, clave: claveFiltros })}
        urlParams={urlParams}
      />
    )
  }

  return <ContenedorSeccion>{tablero}</ContenedorSeccion>
}
