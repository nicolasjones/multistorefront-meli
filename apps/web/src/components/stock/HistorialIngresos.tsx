import { useEffect, useState } from 'react'
import { Box, Chip, Stack, TablePagination, Typography } from '@mui/material'
import { useIngresos, type IngresoFila } from '../../hooks/useIngresos'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'

const TAMANO_ULTIMOS = 10

const formatearFecha = (fecha: string) => fecha.split('-').reverse().join('/')
type Props = {
  // Cambia cuando se registra un ingreso para volver a leer el historial.
  revision: number
}

// «Últimos ingresos» del prototipo (F-PRV-04/F-PRV-05). En esta historia muestra
// las últimas filas; la F-PRV-05 suma los filtros y la paginación completa.
export function HistorialIngresos({ revision }: Props) {
  const [pagina, setPagina] = useState(1)
  const { filas, total, hayError, cargando, recargar } = useIngresos({ pagina, tamano: TAMANO_ULTIMOS })

  useEffect(() => {
    if (revision > 0) void recargar()
  }, [revision, recargar])

  const columnas: ColumnaAdaptable<IngresoFila>[] = [
    { clave: 'fecha', encabezado: 'Fecha', render: (fila) => <Typography variant="b">{formatearFecha(fila.fecha)}</Typography> },
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack spacing={0}>
          <Typography variant="b">{fila.producto_nombre}</Typography>
          <Typography variant="xs">{fila.producto_sku ?? '—'}</Typography>
        </Stack>
      ),
    },
    { clave: 'cantidad', encabezado: 'Cantidad', align: 'right', render: (fila) => <Typography variant="b">{`+${fila.cantidad}`}</Typography> },
    { clave: 'destino', encabezado: 'Destino', render: (fila) => <Typography variant="b">{fila.destino}</Typography> },
    { clave: 'empresa', encabezado: 'Tienda', render: (fila) => <Typography variant="b">{fila.empresa}</Typography> },
    { clave: 'proveedor', encabezado: 'Proveedor', render: (fila) => <Typography variant="b">{fila.proveedor}</Typography> },
    { clave: 'operador', encabezado: 'Operador', render: (fila) => <Typography variant="b">{fila.operador}</Typography> },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (fila) => (
        <Stack spacing={0.5} alignItems="flex-start">
          <Chip size="small" label={fila.estado === 'anulado' ? 'Anulado' : 'Registrado'} color={fila.estado === 'anulado' ? 'warning' : 'success'} variant="outlined" />
          {fila.estado === 'anulado' && fila.motivo_anulacion ? <Typography variant="xs">{fila.motivo_anulacion}</Typography> : null}
        </Stack>
      ),
    },
  ]

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography variant="h3" component="h2">Últimos ingresos</Typography>
        <Typography variant="xs">{total} {total === 1 ? 'línea' : 'líneas'}</Typography>
      </Stack>
      {hayError ? (
        <EstadoError descripcion="No pudimos cargar los últimos ingresos." reintentar={() => void recargar()} />
      ) : filas === null ? (
        <EstadoCargaPagina />
      ) : filas.length === 0 ? (
        <EstadoVacio titulo="Todavía no hay ingresos de mercadería." descripcion="Cuando registres el primero, lo vas a ver acá." />
      ) : (
        <Box aria-busy={cargando} sx={{ opacity: cargando ? 0.5 : 1, transition: 'opacity 150ms' }}>
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(fila) => `${fila.ingreso_id}-${fila.producto_id}`}
            etiquetaTabla="Últimos ingresos de mercadería"
          />
          <TablePagination
            component="div"
            count={total}
            page={pagina - 1}
            rowsPerPage={TAMANO_ULTIMOS}
            rowsPerPageOptions={[TAMANO_ULTIMOS]}
            onPageChange={(_, nueva) => setPagina(nueva + 1)}
            labelRowsPerPage="Líneas por página"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          />
        </Box>
      )}
    </Stack>
  )
}
