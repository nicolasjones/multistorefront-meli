import { useState } from 'react'
import { Box, Chip, LinearProgress, Stack, Typography } from '@mui/material'
import { useComprasCliente, type CompraCliente } from '../../hooks/useComprasCliente'
import { formatearFecha, formatearPesos } from '../../lib/formatoRanking'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { CargaInfinita } from '../pagina/CargaInfinita'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_TANDA = 10

const etiquetaTipo: Record<string, string> = { factura: 'Factura', presupuesto: 'Presupuesto' }
const etiquetaEstado = (estado: string) => estado.charAt(0).toUpperCase() + estado.slice(1)

const columnas: ColumnaAdaptable<CompraCliente>[] = [
  { clave: 'numero', encabezado: 'Comprobante', render: (c) => `${etiquetaTipo[c.tipo] ?? c.tipo} ${c.numero}` },
  { clave: 'fecha', encabezado: 'Fecha', render: (c) => formatearFecha(c.fecha) },
  { clave: 'estado', encabezado: 'Estado', render: (c) => <Chip size="small" label={etiquetaEstado(c.estado)} /> },
  { clave: 'total', encabezado: 'Total (sin IVA)', align: 'right', render: (c) => formatearPesos(c.total_sin_iva) },
]

// Sección «Compras» de la ficha del cliente (F-CLI-10): «Resumen comercial» (total
// facturado del año en curso, mismo criterio y base sin IVA que el ranking) y
// «Últimos comprobantes». Los números de comprobante son texto: el enlace al
// comprobante es de Ventas. Un error acá no afecta al resto de la ficha.
export function ComprasCliente({ clienteId }: { clienteId: string }) {
  const [pagina, setPagina] = useState(1)
  const { compras, total, facturadoAnio, isLoading, isFetching, isError, refetch } =
    useComprasCliente(clienteId, pagina, TAMANO_TANDA)

  // Carga infinita (Principio VI): cada tanda de comprobantes se suma a las anteriores.
  const listado = useListadoAcumulado({
    items: compras, pagina, setPagina, total, cargando: isFetching, reinicio: clienteId,
  })
  const falloTanda = isError && listado.filas.length > 0

  return (
    <Box component="section" aria-labelledby="titulo-compras-cliente">
      <Typography id="titulo-compras-cliente" component="h2" variant="h6" sx={{ mb: 1 }}>Compras</Typography>
      {isLoading ? (
        <EstadoCargaPagina />
      ) : isError && !falloTanda ? (
        <EstadoError descripcion="No pudimos cargar las compras del cliente." reintentar={() => void refetch()} />
      ) : (
        <Stack spacing={2}>
          <Box>
            <Typography component="h3" variant="subtitle1">Resumen comercial</Typography>
            <Typography color="text.secondary">Facturado en el año (sin IVA)</Typography>
            <Typography variant="h5" component="p">{formatearPesos(facturadoAnio)}</Typography>
          </Box>
          <Box aria-busy={isFetching}>
            <Typography component="h3" variant="subtitle1" sx={{ mb: 1 }}>Últimos comprobantes</Typography>
            {isFetching ? <LinearProgress aria-label="Actualizando compras" /> : null}
            {listado.filas.length === 0 ? (
              <EstadoVacio titulo="Este cliente todavía no tiene compras." />
            ) : (
              <>
                <ContenidoAdaptable
                  items={listado.filas}
                  columnas={columnas}
                  obtenerClave={(c) => `${c.tipo}-${c.numero}`}
                  etiquetaTabla="Últimos comprobantes del cliente"
                />
                <CargaInfinita
                  hayMas={listado.hayMas}
                  cargando={listado.cargandoMas}
                  hayError={falloTanda}
                  onCargarMas={falloTanda ? () => void refetch() : listado.cargarMas}
                />
              </>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  )
}
