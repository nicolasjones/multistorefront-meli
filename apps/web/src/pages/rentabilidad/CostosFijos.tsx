import { useState } from 'react'
import { Alert, Stack } from '@mui/material'
import { Navigate } from 'react-router'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError, EstadoTableroNoDisponible } from '../../components/estados/EstadosPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { useBanderaMargenCostosFijos } from '../../hooks/useBanderaMargenCostosFijos'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { AVISO_MES_EN_CURSO, TEXTO_METODO_COSTOS_FIJOS, urlParamsCostosFijos } from '../../lib/costosFijos'
import { NOMBRE_REPORTE_DESPUES_DE_COSTOS_FIJOS, RUTA_RENTABILIDAD, SECCION_RENTABILIDAD } from '../../lib/rentabilidad'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'
import { PestanasRentabilidad } from './PestanasRentabilidad'

// «Rentabilidad · Después de costos fijos» (F-GAS-03, RF-GAS-14; pantalla sin prototipo, UI mínima declarada en la spec: mismo
// patrón que Comparativo e Historia). Tarjetas por tienda y consolidado, cortes por producto y categoría y el rótulo del método
// salen del tablero de Superset embebido; el aviso del método, el filtro de tienda, el error con `Reintentar` y el acceso
// restringido son de Refine. Con la bandera `margen_costos_fijos` apagada la ruta redirige a Rentabilidad (la pestaña no existe).
// El filtro de tienda sigue a la empresa activa de la barra superior (Principio VIII): el tablero se remonta con la tienda
// nueva y el token del guest ya viene acotado por la base a las empresas accesibles (`reportes.filtro_empresa`). La ruta va
// envuelta en RequiereAccesoSeccion (`rentabilidad` ≥ lectura); ante un 403 del token se muestra el mismo acceso restringido.
export function RentabilidadCostosFijos() {
  const { activa, cargando: cargandoBandera } = useBanderaMargenCostosFijos()
  const { reportes, isLoading: cargandoReportes } = useReportesAsignados()
  const { empresas, valor: empresaId, cambiar, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()

  // Cada intento remonta el tablero: repite la solicitud del token y el montaje.
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)

  const empresaNombre = empresas.find((empresa) => empresa.id === empresaId)?.nombre ?? null
  const urlParams = urlParamsCostosFijos(empresaNombre)
  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_DESPUES_DE_COSTOS_FIJOS)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }

  if (cargandoBandera) return <EstadoCargaPagina />
  if (!activa) return <Navigate to={RUTA_RENTABILIDAD} replace />
  if (fallo === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Rentabilidad" seccionClave={SECCION_RENTABILIDAD} />
  }

  let tablero
  if (cargandoReportes || cargandoTiendas) tablero = <EstadoCargaPagina />
  else if (!reporte) {
    tablero = <EstadoTableroNoDisponible nombre="«Después de costos fijos»" />
  } else if (fallo === 'no_disponible') {
    tablero = <EstadoError descripcion="No pudimos cargar el tablero «Después de costos fijos»." reintentar={reintentar} />
  } else {
    tablero = (
      <ReporteEmbebido
        key={`${reporte.id}-${JSON.stringify(urlParams)}-${intento}`}
        reporteId={reporte.id}
        alFallar={setFallo}
        urlParams={urlParams}
      />
    )
  }

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Rentabilidad"
        descripcion="Margen estimado por canal, producto y publicación."
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasRentabilidad />}
      />
      <Alert severity="info" role="note">
        {TEXTO_METODO_COSTOS_FIJOS} {AVISO_MES_EN_CURSO}
      </Alert>
      <FiltroEmpresa empresas={empresas} valor={empresaId} onCambiar={cambiar} cargando={cargandoTiendas} hayError={errorTiendas} />
      {tablero}
    </Stack>
  )
}
