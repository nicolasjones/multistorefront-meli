import { Box, Link, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import { Link as EnlaceRuta, useNavigate } from 'react-router'
import { CargaInfinita } from '../../../components/pagina/CargaInfinita'
import { EstadoCargaPagina } from '../../../components/estados/EstadosPagina'
import { useListadoPorCursor } from '../../../hooks/useListadoPorCursor'
import {
  enlaceCompra,
  ETIQUETA_TIPO,
  formatearFechaCuenta,
  formatearImporteArs,
  formatearNumeroComprobante,
  leerMisCompras,
  type CompraResumen,
  type CursorCompras,
} from '../../../lib/tiendaCuentaDatos'
import { ErrorConReintento } from '../ErrorConReintento'
import { LINEA_SUAVE } from '../layout/medidas'
import { useCelular } from '../useAnchoCelular'
import { EstadoComprobante } from './EstadoComprobante'
import { VacioMiCuenta } from './VacioMiCuenta'

// Marca que el detalle se abrió desde la lista: la pantalla lo cierra con «atrás» en vez de dejar una entrada de más.
const ESTADO_DESDE_LISTA = { desdeLista: true }
const textoContador = (n: number) => `${n} ${n === 1 ? 'comprobante' : 'comprobantes'}`

// «Compras y presupuestos» de «Mi cuenta» (F-CLI-20, FR-003/FR-004, P-3): los comprobantes de ESTE cliente en ESTA tienda,
// nuevos primero, por tandas de 20 con carga infinita («Cargar más» operable con teclado). Tabla de cinco columnas desde `md`
// y tarjetas en celular y tableta. Estado público con texto y color, total con IVA; nunca cobro ni despacho (D-10). Toda la
// fila (o tarjeta) lleva al detalle. El nombre evita chocar con `components/clientes/ComprasCliente` del panel.
export function HistorialMiCuenta({ host, alSinAcceso }: { host: string; alSinAcceso: () => void }) {
  const celular = useCelular()
  const navigate = useNavigate()
  const listado = useListadoPorCursor<CompraResumen, CursorCompras>({
    clave: host,
    leer: (cursor) => leerMisCompras(host, cursor),
    idDe: (fila) => fila.id,
    alSinAcceso,
  })

  if (listado.fase === 'sin_acceso') return null
  if (listado.fase === 'cargando') return <EstadoCargaPagina etiqueta="Cargando tus compras" />
  if (listado.fase === 'error') return <ErrorConReintento titulo="No pudimos cargar tus compras." alReintentar={listado.reintentar} />
  if (listado.filas.length === 0 && !listado.hayMas) {
    return <VacioMiCuenta titulo="Todavía no tenés compras ni presupuestos en esta tienda" descripcion="Cuando compres o pidas un presupuesto, lo vas a ver acá." />
  }

  return (
    <Box>
      <Typography component="p" aria-live="polite" color="text.secondary" sx={{ mb: 1 }}>{textoContador(listado.total)}</Typography>
      {celular ? (
        <Box component="ul" aria-label="Compras y presupuestos" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5 }}>
          {listado.filas.map((fila) => (
            <Box component="li" key={fila.id}>
              <Link
                component={EnlaceRuta}
                to={enlaceCompra(fila.id)}
                state={ESTADO_DESDE_LISTA}
                underline="none"
                color="inherit"
                sx={{ display: 'block', border: LINEA_SUAVE, borderRadius: '8px', p: 2, minHeight: (tema) => tema.spacing(5.5), '&:hover, &:focus-visible': { bgcolor: 'action.hover' } /* estilos-sueltos: ok */ }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography component="span" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{ETIQUETA_TIPO[fila.tipo]} {formatearNumeroComprobante(fila.numero)}</Typography>
                  <EstadoComprobante estado={fila.estado} />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                  <Typography component="span" color="text.secondary">{formatearFechaCuenta(fila.fecha)}</Typography>
                  <Typography component="span" sx={{ fontWeight: 600 }}>{formatearImporteArs(fila.totalConIva)}</Typography>
                </Box>
              </Link>
            </Box>
          ))}
        </Box>
      ) : (
        <TableContainer>
          <Table aria-label="Compras y presupuestos">
            <TableHead>
              <TableRow>
                <TableCell>Fecha</TableCell>
                <TableCell>Número</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Total con IVA</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {listado.filas.map((fila) => (
                <TableRow key={fila.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(enlaceCompra(fila.id), { state: ESTADO_DESDE_LISTA })}>
                  <TableCell>{formatearFechaCuenta(fila.fecha)}</TableCell>
                  <TableCell>
                    <Link
                      component={EnlaceRuta}
                      to={enlaceCompra(fila.id)}
                      state={ESTADO_DESDE_LISTA}
                      aria-label={`Ver el detalle de ${ETIQUETA_TIPO[fila.tipo].toLowerCase()} ${formatearNumeroComprobante(fila.numero)} del ${formatearFechaCuenta(fila.fecha)}`}
                      onClick={(evento) => evento.stopPropagation()}
                    >
                      {formatearNumeroComprobante(fila.numero)}
                    </Link>
                  </TableCell>
                  <TableCell>{ETIQUETA_TIPO[fila.tipo]}</TableCell>
                  <TableCell><EstadoComprobante estado={fila.estado} /></TableCell>
                  <TableCell align="right">{formatearImporteArs(fila.totalConIva)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={listado.errorMas} onCargarMas={listado.cargarMas} textoFin="Llegaste al final de tus compras y presupuestos" sustantivo="comprobantes" cargados={listado.filas.length} />
    </Box>
  )
}
