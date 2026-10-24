import { lazy, Suspense, useState } from 'react'
import { Alert, Button, Snackbar, Stack } from '@mui/material'
import { Link } from 'react-router'
import { ReporteEmbebido, type MotivoFalloReporte } from '../../components/ReporteEmbebido'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { PestanasPagina } from '../../components/pagina/PestanasPagina'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useReportesAsignados } from '../../hooks/useReportesAsignados'
import { useConteoMargen } from '../../hooks/useRentabilidad'
import {
  NOMBRE_REPORTE_RESUMEN,
  RUTA_POR_PRODUCTO,
  RUTA_POR_PRODUCTO_BAJO_O_NEGATIVO,
  RUTA_RENTABILIDAD,
  SECCION_RENTABILIDAD,
  hayProductosEnRiesgo,
} from '../../lib/rentabilidad'
import { AccesoRestringido } from '../acceso-restringido/AccesoRestringido'
import { ComoSeCalcula } from './ComoSeCalcula'

// El diálogo (MUI Dialog + formulario) queda fuera de la carga inicial de la pantalla (Principio VI).
const DialogoUmbral = lazy(() => import('./DialogoUmbral').then((modulo) => ({ default: modulo.DialogoUmbral })))

// Sin «Por publicación de ML» (FR-010): es de la épica de Mercado Libre (Etapa 2).
const PESTANAS = [
  { etiqueta: 'Resumen', to: RUTA_RENTABILIDAD },
  { etiqueta: 'Por producto', to: RUTA_POR_PRODUCTO },
]


// «Rentabilidad · Resumen» (F-REN-02; RentabilidadResumen.dc.html). Tarjetas por empresa y Consolidado
// salen del tablero de Superset embebido (`ReporteEmbebido`); el aviso, «Cómo se calcula», el diálogo
// del umbral y los estados son de Refine. La pantalla compara TODAS las empresas de la organización:
// no depende de la empresa activa de la barra superior (Principio VIII, no aplica; ver matriz de la
// spec). La ruta va envuelta en RequiereAccesoSeccion (`rentabilidad` ≥ lectura): sin la sección no
// se monta nada ni se pide token. Ante un 403 del token se muestra el mismo acceso restringido.
export function RentabilidadResumen() {
  const { reportes, isLoading: cargandoReportes } = useReportesAsignados()
  const { nivel } = useNivelSeccion(SECCION_RENTABILIDAD)
  const { empresas } = useEmpresas()
  const { conteo, hayError: hayErrorConteo, recargar: recargarConteo } = useConteoMargen(true)
  const puedeEditar = nivel === 'edicion'

  // Cada intento remonta el tablero: repite la solicitud del token y el montaje (FR-017).
  const [intento, setIntento] = useState(0)
  const [fallo, setFallo] = useState<MotivoFalloReporte | null>(null)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const reporte = reportes.find((candidato) => candidato.nombre === NOMBRE_REPORTE_RESUMEN)
  const reintentar = () => {
    setFallo(null)
    setIntento((anterior) => anterior + 1)
  }
  const alGuardar = () => {
    setDialogoAbierto(false)
    setAviso('Umbral de margen bajo guardado.')
    // Recarga el tablero y el aviso con el umbral nuevo (FR-018).
    setFallo(null)
    setIntento((anterior) => anterior + 1)
    void recargarConteo()
  }

  if (fallo === 'prohibido') {
    return <AccesoRestringido rol="actual" seccion="Rentabilidad" seccionClave={SECCION_RENTABILIDAD} />
  }

  let tablero
  if (cargandoReportes || (conteo === null && !hayErrorConteo)) tablero = <EstadoCargaPagina />
  else if (conteo && conteo.productosConMargen === 0) {
    tablero = (
      <EstadoVacio
        titulo="Todavía no hay productos con margen calculado"
        descripcion="Cargá el costo de tus productos (y la cotización del dólar si están en USD) para ver la rentabilidad."
      />
    )
  } else if (!reporte) {
    tablero = <EstadoError descripcion="El tablero de Rentabilidad todavía no está disponible para tu organización." />
  } else if (fallo === 'no_disponible') {
    tablero = <EstadoError descripcion="No pudimos cargar el tablero de Rentabilidad." reintentar={reintentar} />
  } else {
    tablero = <ReporteEmbebido key={`${reporte.id}-${intento}`} reporteId={reporte.id} alFallar={setFallo} />
  }

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Rentabilidad"
        descripcion="Margen estimado por canal, producto y publicación."
        contexto={<ContextoOrganizacionActiva />}
        accion={puedeEditar ? <Button variant="outlined" onClick={() => setDialogoAbierto(true)}>Umbral de margen bajo</Button> : undefined}
        pestanas={<PestanasPagina pestanas={PESTANAS} etiqueta="Secciones de Rentabilidad" />}
      />
      {conteo && hayProductosEnRiesgo(conteo) ? (
        <Alert
          severity="warning"
          action={<Button color="inherit" size="small" component={Link} to={RUTA_POR_PRODUCTO_BAJO_O_NEGATIVO}>Ver detalle</Button>}
        >
          Hay productos que se venden por debajo del costo o casi. Revisalos en Por producto.
        </Alert>
      ) : null}
      {tablero}
      <ComoSeCalcula empresas={empresas.filter((empresa) => empresa.activa)} />
      {dialogoAbierto ? (
        <Suspense fallback={null}>
          <DialogoUmbral onCerrar={() => setDialogoAbierto(false)} onGuardado={alGuardar} />
        </Suspense>
      ) : null}
      <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Stack>
  )
}
