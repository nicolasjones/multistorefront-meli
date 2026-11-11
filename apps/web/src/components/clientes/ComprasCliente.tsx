import { useState } from 'react'
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import { useComprasCliente, type CompraCliente } from '../../hooks/useComprasCliente'
import { useCuentaCorrienteCliente, type ComprobanteDeuda } from '../../hooks/useCuentaCorrienteCliente'
import { formatearFecha, formatearPesos, formatearPesosConCentavos } from '../../lib/formatoRanking'
import { tokens } from '../../tema/tokens'
import { EtiquetaEstado, type VarianteEtiqueta } from '../base/EtiquetaEstado'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { CargaInfinita } from '../pagina/CargaInfinita'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_TANDA = 10

const etiquetaTipo: Record<string, string> = { factura: 'Factura', presupuesto: 'Presupuesto' }
const etiquetaEstado = (estado: string) => {
  const texto = estado.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// Tonos del estado en esta pantalla (prototipo `ClienteFicha.dc.html`): «Deuda» en ámbar,
// «Cobrado» en verde y «Armando» en azul; el resto, neutro.
const tonosEstado: Record<string, VarianteEtiqueta> = {
  deuda: 'aviso',
  cobrado: 'exito',
  armando: 'primario',
}
const tonoEstado = (estado: string): VarianteEtiqueta => tonosEstado[estado] ?? 'neutral'

// El «Saldo deudor» del prototipo: ámbar cuando el cliente debe, verde cuando no debe nada.
const colorSaldo = (saldo: number) =>
  saldo > 0 ? tokens.color.etiqueta.aviso.texto : tokens.color.etiqueta.exito.texto

const columnas: ColumnaAdaptable<CompraCliente>[] = [
  { clave: 'numero', encabezado: 'Comprobante', render: (c) => `${etiquetaTipo[c.tipo] ?? c.tipo} ${c.numero}` },
  { clave: 'fecha', encabezado: 'Fecha', render: (c) => formatearFecha(c.fecha) },
  { clave: 'estado', encabezado: 'Estado', render: (c) => <EtiquetaEstado texto={etiquetaEstado(c.estado)} variante={tonoEstado(c.estado)} /> },
  { clave: 'total', encabezado: 'Total (sin IVA)', align: 'right', render: (c) => formatearPesos(c.total_sin_iva) },
]

const columnasCuenta: ColumnaAdaptable<ComprobanteDeuda>[] = [
  { clave: 'numero', encabezado: 'Comprobante', render: (d) => d.numero },
  { clave: 'fecha', encabezado: 'Fecha', render: (d) => formatearFecha(d.fecha) },
  { clave: 'estado', encabezado: 'Estado', render: (d) => <EtiquetaEstado texto={etiquetaEstado(d.estado)} variante={tonoEstado(d.estado)} /> },
  { clave: 'total', encabezado: 'Total', align: 'right', render: (d) => formatearPesosConCentavos(d.total_con_iva) },
  { clave: 'cobrado', encabezado: 'Cobrado', align: 'right', render: (d) => formatearPesosConCentavos(d.cobrado) },
  { clave: 'notas_credito', encabezado: 'Notas de crédito', align: 'right', render: (d) => formatearPesosConCentavos(d.notas_credito) },
  { clave: 'saldo', encabezado: 'Saldo', align: 'right', render: (d) => formatearPesosConCentavos(d.saldo) },
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
    useComprasCliente(clienteId, pagina, TAMANO_TANDA)
  const { saldo, documentos, isLoading: cargandoCuenta, isError: errorCuenta, refetch: reintentarCuenta } =
    useCuentaCorrienteCliente(clienteId)

  // Carga infinita (Principio VI): cada tanda de comprobantes se suma a las anteriores.
  const listado = useListadoAcumulado({
    items: compras, pagina, setPagina, total, cargando: isFetching, reinicio: clienteId,
  })
  const falloTanda = isError && listado.filas.length > 0

  return (
    <Box component="section" aria-labelledby="titulo-compras-cliente">
      <Typography id="titulo-compras-cliente" component="h2" variant="h6" sx={{ mb: 1 }}>Compras</Typography>
      <Stack spacing={2}>
        {/* El «Saldo deudor» no depende de las compras: si las compras fallan, el saldo sigue
            a la vista (FR-005) y el facturado del año queda en «—». */}
        {!isLoading && (
          <Box>
            <Typography component="h3" variant="subtitle1">Resumen comercial</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <Box>
                <Typography color="text.secondary">Facturado en el año (sin IVA)</Typography>
                <Typography variant="h5" component="p">{isError && !falloTanda ? '—' : formatearPesos(facturadoAnio)}</Typography>
              </Box>
              <Box>
                <Typography color="text.secondary">Saldo deudor</Typography>
                <Typography
                  variant="h5"
                  component="p"
                  sx={cargandoCuenta || errorCuenta ? undefined : { color: colorSaldo(saldo) }}
                >
                  {cargandoCuenta || errorCuenta ? '—' : formatearPesosConCentavos(saldo)}
                </Typography>
              </Box>
            </Stack>
          </Box>
        )}
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError && !falloTanda ? (
          <EstadoError descripcion="No pudimos cargar las compras del cliente." reintentar={() => void refetch()} />
        ) : (
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
                  // El número se repite entre tiendas y la fila no trae id; la lista solo se acumula al
                  // final (carga infinita) y se reinicia entera, así que el índice es estable.
                  obtenerClave={(c, indice) => `${c.tipo}-${c.numero}-${indice}`}
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
              // El id del comprobante: el número se repite entre tiendas y es lo que
              // distingue una fila de otra.
              obtenerClave={(d) => d.id}
              etiquetaTabla="Comprobantes con saldo del cliente"
            />
          )}
        </Box>
      </Stack>
    </Box>
  )
}
