import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Snackbar, Stack,
  TablePagination, Typography,
} from '@mui/material'
import { useFaltantes } from '../../hooks/useFaltantes'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { mensajeResultadoAviso, TAMANO_PAGINA_FALTANTES, type Faltante } from '../../lib/faltantes'
import { ESTADOS_STOCK } from '../../lib/stock'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { PestanasStock } from './PestanasStock'
import { tokens } from '../../tema/tokens'

// 'YYYY-MM-DD' → 'DD/MM/YYYY' sin pasar por Date (evita el corrimiento de huso de un `date`).
// `confirmado_en` es nullable en la base: si una factura confirmada viniera sin fecha, la pantalla
// muestra «—» en vez de romperse al renderizar (un error de render dejaba el panel en blanco).
const formatearFecha = (fecha: string | null | undefined) => {
  if (!fecha) return '—'
  const partes = fecha.split('-')
  return partes.length === 3 ? partes.reverse().join('/') : fecha
}

type Aviso = { texto: string; severidad: 'success' | 'info' | 'error' }

// Faltantes (F-STK-17, MSF-405): líneas «A pedido» de facturas confirmadas que esperan mercadería. Una
// línea sale sola cuando su reserva se descuenta o se libera; no hay cierre manual. Se avisa al cliente
// (un correo por cliente) cuando el producto vuelve a tener stock. La base decide qué se ve y qué se
// puede avisar (RLS y `ventas` por tienda); acá solo se gatea la UI.
export function FaltantesStock() {
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const { nivel: nivelVentas } = useNivelSeccion('ventas')
  const puedeAvisar = nivelVentas === 'edicion'
  const [pagina, setPagina] = useState(1)
  const [dialogo, setDialogo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  const {
    ambito, faltantes, total, isLoading, isFetching, isError, refetch, elegidos, alternar, alternarTodos, avisar,
  } = useFaltantes({ empresaId, pagina, tamano: TAMANO_PAGINA_FALTANTES })

  // Cambió la empresa (barra superior o filtro): la pantalla se reencuadra (FR-311). Se ajusta en el
  // MISMO render —no en un efecto— para que no se dibuje ni un cuadro con la paginación de la empresa
  // anterior ni el diálogo abierto sobre la nueva, y para que la consulta de la nueva empresa salga
  // una sola vez, ya en la página 1.
  // La selección vive en el hook y queda atada a su ámbito: deja de valer sola (nunca se avisa a otra
  // empresa).
  const [ambitoVisto, setAmbitoVisto] = useState(ambito)
  if (ambito !== ambitoVisto) {
    setAmbitoVisto(ambito)
    setPagina(1)
    if (dialogo) {
      setDialogo(false)
      setAviso({ texto: 'Cambiaste de empresa: se cerró el aviso a los clientes.', severidad: 'info' })
    }
  }

  const cantidadElegidos = Object.keys(elegidos).length
  const clientesElegidos = new Set(Object.values(elegidos)).size
  const todosElegidos = faltantes.length > 0 && faltantes.every((fila) => elegidos[fila.linea_id])

  const enviar = async () => {
    if (enviando) return
    setEnviando(true)
    try {
      const resultado = await avisar()
      setDialogo(false)
      setAviso({ texto: mensajeResultadoAviso(resultado), severidad: 'success' })
    } catch (error) {
      setAviso({ texto: error instanceof Error ? error.message : 'No pudimos enviar los avisos. Probá de nuevo.', severidad: 'error' })
    } finally {
      setEnviando(false)
    }
  }

  const columnas: ColumnaAdaptable<Faltante>[] = [
    {
      clave: 'seleccion',
      // La columna de casillas no lleva texto visible: el prototipo la dibuja sin nombre, con el
      // «seleccionar todo» en el encabezado (ver `seleccionEnCabecera` más abajo).
      encabezado: '',
      // La casilla NO se oculta en la vista angosta: es el control para elegir faltantes y
      // tiene que seguir disponible a 320 px (por debajo de 900 px la tabla pasa a tarjetas).
      // El nombre accesible lleva el comprobante: el mismo producto puede estar pedido por el
      // mismo cliente en más de un comprobante y, sin eso, las casillas se nombran igual.
      render: (fila) => (
        <Checkbox
          checked={Boolean(elegidos[fila.linea_id])}
          onChange={() => alternar(fila)}
          disabled={!puedeAvisar}
          slotProps={{
            input: {
              'aria-label': `Seleccionar ${fila.producto} de ${fila.cliente} del comprobante ${fila.comprobante_numero}`,
            },
          }}
        />
      ),
    },
    { clave: 'tienda', encabezado: 'Tienda', render: (fila) => <EtiquetaEstado texto={fila.empresa} variante="contorno" /> },
    { clave: 'cliente', encabezado: 'Cliente', render: (fila) => <Typography variant="b">{fila.cliente}</Typography> },
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack spacing={0}>
          <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.producto}</Typography>
          <Typography variant="xs">{fila.sku ?? '—'}</Typography>
        </Stack>
      ),
    },
    { clave: 'pedido', encabezado: 'Pedido', align: 'right', render: (fila) => <Typography variant="b">{fila.pedido}</Typography> },
    {
      clave: 'comprobante',
      encabezado: 'Comprobante',
      render: (fila) => <Link component={RouterLink} to={`/ventas/comprobantes/${fila.comprobante_id}`}>{fila.comprobante_numero}</Link>,
    },
    { clave: 'desde', encabezado: 'Desde', render: (fila) => <Typography variant="b">{formatearFecha(fila.desde)}</Typography> },
    {
      clave: 'stock',
      encabezado: 'Stock hoy',
      render: (fila) => {
        const estado = ESTADOS_STOCK.find((e) => e.valor === fila.estado_stock)
        return <EtiquetaEstado texto={estado?.etiqueta ?? fila.estado_stock} variante={estado?.variante ?? 'neutral'} />
      },
    },
    {
      clave: 'aviso',
      encabezado: 'Aviso',
      render: (fila) => <EtiquetaEstado texto={fila.aviso === 'avisado' ? 'Avisado' : 'Sin avisar'} variante={fila.aviso === 'avisado' ? 'exito' : 'neutral'} />,
    },
  ]

  const contenido = () => {
    if (isError) return <EstadoError descripcion="No pudimos cargar los faltantes." reintentar={() => void refetch()} />
    if (isLoading) return <EstadoCargaPagina />
    if (faltantes.length === 0 && total === 0) {
      return <EstadoVacio titulo="No hay faltantes" descripcion="Cuando vendas productos «A pedido» sin stock, los vas a ver acá." />
    }
    return (
      <Box aria-busy={isFetching} sx={{ opacity: isFetching ? 0.5 : 1, transition: 'opacity 150ms' }}>
        <ContenidoAdaptable
          items={faltantes}
          columnas={columnas}
          obtenerClave={(fila) => fila.linea_id}
          etiquetaTabla="Faltantes"
          seleccionEnCabecera={puedeAvisar ? (
            // El prototipo pone el «seleccionar todo» en el encabezado de la columna de casillas,
            // sin texto visible (`VentasFaltantes.dc.html`): se nombra con `aria-label`.
            <Checkbox
              checked={todosElegidos}
              indeterminate={!todosElegidos && faltantes.some((fila) => elegidos[fila.linea_id])}
              onChange={alternarTodos}
              slotProps={{ input: { 'aria-label': 'Seleccionar todos' } }}
            />
          ) : undefined}
        />
        <TablePagination
          component="div"
          count={total}
          page={pagina - 1}
          rowsPerPage={TAMANO_PAGINA_FALTANTES}
          rowsPerPageOptions={[TAMANO_PAGINA_FALTANTES]}
          onPageChange={(_, nueva) => setPagina(nueva + 1)}
          labelRowsPerPage="Faltantes por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
        />
        <Typography variant="xs" component="p" sx={{ mt: 1 }}>
          {`${cantidadElegidos} ${cantidadElegidos === 1 ? 'seleccionado' : 'seleccionados'} de ${total} ${total === 1 ? 'faltante' : 'faltantes'}. `}
          Un faltante se cierra solo cuando se ingresa la mercadería.
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      <EncabezadoPagina
        titulo="Faltantes"
        descripcion="Líneas vendidas o pedidas sin stock. Se avisa al cliente cuando el producto vuelve."
        contexto={<ContextoOrganizacionActiva />}
        accion={puedeAvisar ? (
          <Button variant="contained" disabled={cantidadElegidos === 0} onClick={() => setDialogo(true)}>
            {`Avisar a los seleccionados (${cantidadElegidos})`}
          </Button>
        ) : undefined}
      />
      <ContenedorSeccion>
        <PestanasStock activa="faltantes" />
        <Stack spacing={2}>
          {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
            <FiltroEmpresa
              empresas={empresas}
              valor={empresaId}
              onCambiar={(id) => {
                elegirEmpresa(id)
                setPagina(1)
              }}
              cargando={cargandoTiendas}
              hayError={errorTiendas}
              textoAyuda="Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda."
            />
          ) : null}
          {contenido()}
        </Stack>
      </ContenedorSeccion>

      <Dialog open={dialogo} onClose={() => (enviando ? undefined : setDialogo(false))} aria-labelledby="titulo-avisar-faltantes">
        <DialogTitle id="titulo-avisar-faltantes">Avisar a los clientes</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`Se envía un correo a ${clientesElegidos} ${clientesElegidos === 1 ? 'cliente' : 'clientes'} con el detalle de los productos que volvieron a tener stock. Los faltantes avisados quedan marcados y no se vuelven a avisar.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogo(false)} disabled={enviando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void enviar()} disabled={enviando}>Enviar avisos</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={aviso !== null} autoHideDuration={5000} onClose={() => setAviso(null)}>
        <Alert severity={aviso?.severidad ?? 'success'} onClose={() => setAviso(null)}>{aviso?.texto}</Alert>
      </Snackbar>
    </Box>
  )
}
