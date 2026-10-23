import { Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'
import type { useHistorialCargasCotizacion } from '../../hooks/useHistorialCargasCotizacion'
import { formatearCotizacion, formatearVariacion } from '../../lib/cotizacion'
import {
  PIE_TRAZABILIDAD_COTIZACION,
  formatearFechaHoraCarga,
  textoPreciosCarga,
  tonoVariacion,
  type CargaCotizacion,
  type TonoVariacion,
} from '../../lib/cotizacionHistorial'

type Props = {
  historial: ReturnType<typeof useHistorialCargasCotizacion>
}

const COLOR_CHIP: Record<TonoVariacion, 'warning' | 'success' | 'default'> = { sube: 'warning', baja: 'success', igual: 'default' }

const columnas: ColumnaAdaptable<CargaCotizacion>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (carga) => formatearFechaHoraCarga(carga.cargadaEn) },
  {
    clave: 'valor',
    encabezado: 'Valor',
    align: 'right',
    render: (carga) => <Typography component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatearCotizacion(carga.valor)}</Typography>,
  },
  {
    clave: 'variacion',
    encabezado: 'Variación',
    render: (carga) => <Chip size="small" color={COLOR_CHIP[tonoVariacion(carga.variacionPct)]} label={formatearVariacion(carga.variacionPct)} />,
  },
  { clave: 'cargo', encabezado: 'Cargó', render: (carga) => carga.cargadaPorNombre },
  { clave: 'precios', encabezado: 'Precios', render: (carga) => textoPreciosCarga(carga) },
]

// «Historial de cargas» (F-PRE-04, FR-018; Cotizacion.dc.html): quién cargó cada valor y qué se recalculó,
// de la más nueva a la más vieja, con el pie de trazabilidad. Solo muestra: el historial es inmutable en
// la base. Mercado Libre queda fuera (Etapa 2). Estados de carga, error y vacío compartidos.
export function TablaHistorial({ historial }: Props) {
  const { filas, pagina, haySiguiente, hayAnterior, cargando, hayError, siguiente, anterior, recargar } = historial

  let contenido
  if (hayError) contenido = <EstadoError descripcion="No pudimos leer el historial de cargas." reintentar={recargar} />
  else if (cargando) contenido = <EstadoCargaPagina />
  else if (filas.length === 0) contenido = <EstadoVacio titulo="Todavía no hay cargas confirmadas" descripcion="Cuando se confirme una cotización del dólar la vas a ver acá." />
  else {
    contenido = (
      <>
        <ContenidoAdaptable items={filas} columnas={columnas} obtenerClave={(carga) => carga.id} etiquetaTabla="Historial de cargas de la cotización del dólar" />
        {hayAnterior || haySiguiente ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <Typography variant="xs" aria-live="polite">Página {pagina}</Typography>
            <Button size="small" onClick={anterior} disabled={!hayAnterior}>Anterior</Button>
            <Button size="small" onClick={siguiente} disabled={!haySiguiente}>Siguiente</Button>
          </Stack>
        ) : null}
      </>
    )
  }

  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-historial-cargas">
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.25}>
            <Typography id="titulo-historial-cargas" component="h2" variant="t3">Historial de cargas</Typography>
            <Typography variant="s">Quién cargó cada valor y qué se recalculó</Typography>
          </Stack>
          {contenido}
          <Typography variant="xs">{PIE_TRAZABILIDAD_COTIZACION}</Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}
