import type { ReactNode } from 'react'
import { Box, LinearProgress, Stack, TextField } from '@mui/material'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { useHistorialCotizaciones, type CotizacionHistorica } from '../../hooks/useHistorialCotizaciones'
import { formatearFecha, formatearImporteHistorial } from '../../lib/formatoHistorial'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'

// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const columnas: ColumnaAdaptable<CotizacionHistorica>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (c) => formatearFecha(c.fecha) },
  { clave: 'comprador', encabezado: 'Dólar comprador', align: 'right', render: (c) => <b>{formatearImporteHistorial(c.dolar_comprador)}</b> },
  { clave: 'vendedor', encabezado: 'Dólar vendedor', align: 'right', render: (c) => <b>{formatearImporteHistorial(c.dolar_vendedor)}</b> },
  { clave: 'cargo', encabezado: 'Cargó', render: (c) => (c.cargado_por && c.cargado_por.trim() !== '' ? c.cargado_por : '—') },
]

// Pestaña «Cotizaciones del dólar» (F-VTA-39, FR-021): solo lectura, global de la organización
// (sin filtro de tienda) y con los mismos estados que Ventas y Cobros. El acceso por sección lo
// resuelve la ruta y, en serio, la RLS de `historial_cotizaciones_dolar`.
export function CotizacionesTab() {
  const { filas, total, texto, setTexto, textoAplicado, pagina, setPagina, isLoading, isFetching, isError, refetch } = useHistorialCotizaciones()
  // Carga infinita: se suman las tandas de 25 que ya entrega la RPC de cotizaciones.
  const listado = useListadoAcumulado({ items: filas, pagina, setPagina, total, cargando: isFetching, reinicio: textoAplicado })
  // Si la tanda siguiente falló, «Reintentar» vuelve a pedir esa misma tanda (no salta a la siguiente).
  const falloTanda = isError && pagina > 1
  const hayFiltros = textoAplicado.trim() !== ''

  let contenido: ReactNode
  // Página fuera de rango: el hook vuelve a la 1; mientras tanto no se muestra «Sin resultados».
  if (isLoading || (pagina > 1 && listado.filas.length === 0 && !isError)) {
    contenido = <EstadoCargaPagina />
  } else if (isError && !falloTanda) {
    contenido = <EstadoError descripcion="No pudimos cargar las cotizaciones del dólar." reintentar={() => void refetch()} />
  } else if (listado.filas.length === 0) {
    contenido = hayFiltros ? (
      <EstadoVacio titulo="Sin resultados" descripcion="Probá con otra fecha." />
    ) : (
      <EstadoVacio titulo="Todavía no hay historial importado." descripcion="Cuando se importen las cotizaciones del dólar del sistema anterior, las vas a ver acá." />
    )
  } else {
    contenido = (
      <>
        <ContenidoAdaptable items={listado.filas} columnas={columnas} obtenerClave={(fila) => fila.id} etiquetaTabla="Cotizaciones del dólar históricas" />
        <CargaInfinita
          hayMas={listado.hayMas}
          cargando={listado.cargandoMas}
          hayError={falloTanda}
          onCargarMas={falloTanda ? () => void refetch() : listado.cargarMas}
        />
      </>
    )
  }

  return (
    <Stack spacing={2}>
      <BarraHerramientas contador={isLoading || (isError && !falloTanda) ? undefined : `${total} registros mostrados`}>
        <TextField
          type="search"
          label="Buscar por fecha"
          placeholder="dd/mm/aaaa"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          size="small"
          sx={{ width: 320, maxWidth: '100%' }}
        />
      </BarraHerramientas>

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {isLoading || (isError && !falloTanda) ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
      </Box>
      {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando cotizaciones del dólar" sx={{ height: ALTO_BARRA_CARGA }} /> : null}
      <Box aria-busy={isFetching}>{contenido}</Box>
    </Stack>
  )
}
