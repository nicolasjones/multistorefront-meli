import { useEffect, useState } from 'react'
import { Box, Chip, LinearProgress, Stack, TablePagination, Typography } from '@mui/material'
import { useComprasCliente, type CompraCliente } from '../../hooks/useComprasCliente'
import { useCuentaCorrienteCliente, type ComprobanteDeuda } from '../../hooks/useCuentaCorrienteCliente'
import { formatearFecha, formatearPesos } from '../../lib/formatoRanking'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_PAGINA = 10

const etiquetaTipo: Record<string, string> = { factura: 'Factura', presupuesto: 'Presupuesto' }
const etiquetaEstado = (estado: string) => estado.charAt(0).toUpperCase() + estado.slice(1)

const columnas: ColumnaAdaptable<CompraCliente>[] = [
  { clave: 'numero', encabezado: 'Comprobante', render: (c) => `${etiquetaTipo[c.tipo] ?? c.tipo} ${c.numero}` },
  { clave: 'fecha', encabezado: 'Fecha', render: (c) => formatearFecha(c.fecha) },
  { clave: 'estado', encabezado: 'Estado', render: (c) => <Chip size="small" label={etiquetaEstado(c.estado)} /> },
  { clave: 'total', encabezado: 'Total (sin IVA)', align: 'right', render: (c) => formatearPesos(c.total_sin_iva) },
]

const columnasCuenta: ColumnaAdaptable<ComprobanteDeuda>[] = [
  { clave: 'numero', encabezado: 'Comprobante', render: (d) => d.numero },
  { clave: 'fecha', encabezado: 'Fecha', render: (d) => formatearFecha(d.fecha) },
  { clave: 'estado', encabezado: 'Estado', render: (d) => <Chip size="small" label={etiquetaEstado(d.estado)} /> },
  { clave: 'total', encabezado: 'Total', align: 'right', render: (d) => formatearPesos(d.total_con_iva) },
  { clave: 'cobrado', encabezado: 'Cobrado', align: 'right', render: (d) => formatearPesos(d.cobrado) },
  { clave: 'saldo', encabezado: 'Saldo', align: 'right', render: (d) => formatearPesos(d.saldo) },
]

// Sección «Compras» de la ficha del cliente (F-CLI-10): «Resumen comercial» (total
// facturado del año en curso, mismo criterio y base sin IVA que el ranking) y
// «Últimos comprobantes». Los números de comprobante son texto: el enlace al
// comprobante es de Ventas. Un error acá no afecta al resto de la ficha.
//
// F-CLI-19: la tarjeta «Resumen comercial» suma el «Saldo deudor» (lo que el
// cliente debe, con IVA) y debajo está la «Cuenta corriente»: los comprobantes
// con saldo, con su total, lo cobrado y su saldo.
export function ComprasCliente({ clienteId }: { clienteId: string }) {
  const [pagina, setPagina] = useState(1)
  const { compras, total, facturadoAnio, isLoading, isFetching, isError, refetch } =
    useComprasCliente(clienteId, pagina, TAMANO_PAGINA)
  const { saldo, documentos, isLoading: cargandoCuenta, isError: errorCuenta, refetch: reintentarCuenta } =
    useCuentaCorrienteCliente(clienteId)

  // Si la página pedida quedó más allá del final (se borraron comprobantes), vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && pagina > 1 && compras.length === 0 && total > 0) setPagina(1)
  }, [isLoading, isFetching, isError, pagina, compras.length, total])

  return (
    <Box component="section" aria-labelledby="titulo-compras-cliente">
      <Typography id="titulo-compras-cliente" component="h2" variant="h6" sx={{ mb: 1 }}>Compras</Typography>
      <Stack spacing={2}>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar las compras del cliente." reintentar={() => void refetch()} />
        ) : (
          <>
            <Box>
              <Typography component="h3" variant="subtitle1">Resumen comercial</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
                <Box>
                  <Typography color="text.secondary">Facturado en el año (sin IVA)</Typography>
                  <Typography variant="h5" component="p">{formatearPesos(facturadoAnio)}</Typography>
                </Box>
                <Box>
                  <Typography color="text.secondary">Saldo deudor</Typography>
                  <Typography variant="h5" component="p">
                    {cargandoCuenta || errorCuenta ? '—' : formatearPesos(saldo)}
                  </Typography>
                </Box>
              </Stack>
            </Box>
            <Box aria-busy={isFetching}>
              <Typography component="h3" variant="subtitle1" sx={{ mb: 1 }}>Últimos comprobantes</Typography>
              {isFetching ? <LinearProgress aria-label="Actualizando compras" /> : null}
              {compras.length === 0 ? (
                <EstadoVacio titulo="Este cliente todavía no tiene compras." />
              ) : (
                <>
                  <ContenidoAdaptable
                    items={compras}
                    columnas={columnas}
                    obtenerClave={(c) => `${c.tipo}-${c.numero}`}
                    etiquetaTabla="Últimos comprobantes del cliente"
                  />
                  <TablePagination
                    component="div" count={total} page={pagina - 1} rowsPerPage={TAMANO_PAGINA} rowsPerPageOptions={[TAMANO_PAGINA]}
                    onPageChange={(_, nueva) => setPagina(nueva + 1)}
                    labelRowsPerPage="Comprobantes por página"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                  />
                </>
              )}
            </Box>
          </>
        )}
        <Box component="section" aria-labelledby="titulo-cuenta-corriente">
          <Typography id="titulo-cuenta-corriente" component="h3" variant="subtitle1">Cuenta corriente</Typography>
          <Typography color="text.secondary">Comprobantes con saldo pendiente · importes con IVA</Typography>
          {cargandoCuenta ? (
            <EstadoCargaPagina lineas={2} />
          ) : errorCuenta ? (
            <EstadoError
              descripcion="No pudimos cargar la cuenta corriente del cliente."
              reintentar={() => void reintentarCuenta()}
            />
          ) : documentos.length === 0 ? (
            <EstadoVacio titulo="Este cliente no tiene comprobantes con saldo." />
          ) : (
            <ContenidoAdaptable
              items={documentos}
              columnas={columnasCuenta}
              obtenerClave={(d) => d.numero}
              etiquetaTabla="Comprobantes con saldo del cliente"
            />
          )}
        </Box>
      </Stack>
    </Box>
  )
}
