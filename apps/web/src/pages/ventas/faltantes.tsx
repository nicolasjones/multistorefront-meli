import { useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel,
  LinearProgress, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useListadoAcumulado } from '../../hooks/useListadoAcumulado'
import { useImagenesProductos } from '../../hooks/useImagenesProductos'
import { useListarFaltantes, type ElegidoFaltante } from '../../hooks/useListarFaltantes'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { formatearCuando } from '../../lib/actividad'
import {
  type FaltanteVenta,
  MAXIMO_MENSAJE_AVISO,
  TEXTO_AVISO_POR_DEFECTO,
  estadoStockHoy,
  etiquetaAviso,
  MAXIMO_AVISO_FALTANTES,
  mensajeResultadoAvisoVenta,
  unidadesDisponibles,
  unidadesFaltantes,
} from '../../lib/ventasFaltantes'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { MiniaturaProducto } from '../../components/base/MiniaturaProducto'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 10
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2

// Texto de ayuda del filtro de tienda: el del prototipo («VentasFaltantes»).
const AYUDA_FILTRO_TIENDA =
  'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'

type FiltroAviso = 'todos' | 'para_avisar'
type AvisoEmergente = { texto: string; severidad: 'success' | 'info' | 'warning' | 'error' }

type OpcionesColumnas = {
  imagenes: ReadonlyMap<string, string>
  // Solo con `ventas` en edición hay casillas para elegir faltantes a avisar (FR-002).
  seleccion?: { elegidos: Readonly<Record<string, ElegidoFaltante>>; alternar: (faltante: FaltanteVenta) => void }
}

const armarColumnas = ({ imagenes, seleccion }: OpcionesColumnas): ColumnaAdaptable<FaltanteVenta>[] => [
  ...(seleccion
    ? [
        {
          clave: 'seleccion',
          // Sin texto visible: el prototipo dibuja la columna de casillas sin nombre, con el «seleccionar todo»
          // en el encabezado. La casilla sigue disponible en la vista angosta (tarjetas). El nombre lleva el
          // comprobante: el mismo cliente puede tener el mismo producto en más de un comprobante.
          encabezado: '',
          render: (faltante: FaltanteVenta) => (
            <Checkbox
              checked={Boolean(seleccion.elegidos[faltante.id])}
              onChange={() => seleccion.alternar(faltante)}
              slotProps={{
                input: {
                  'aria-label': `Seleccionar ${faltante.producto} de ${faltante.cliente} del comprobante ${faltante.comprobante}`,
                },
              }}
            />
          ),
        },
      ]
    : []),
  { clave: 'empresa', encabezado: 'Tienda', render: (faltante) => <EtiquetaEstado texto={faltante.empresa} variante="contorno" /> },
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    render: (faltante) => <Typography component="span" sx={{ fontWeight: 600 }}>{faltante.cliente}</Typography>,
  },
  {
    clave: 'producto',
    encabezado: 'Producto',
    render: (faltante) => (
      <Stack direction="row" spacing={1.25} alignItems="center">
        <MiniaturaProducto alt="" src={faltante.producto_id ? imagenes.get(faltante.producto_id) : undefined} />
        <Stack spacing={0}>
          <Typography component="span" sx={{ fontWeight: 600 }}>{faltante.producto}</Typography>
          <Typography component="span" variant="caption" color="text.secondary">{faltante.sku ?? '—'}</Typography>
        </Stack>
      </Stack>
    ),
  },
  {
    clave: 'pedido',
    encabezado: 'Pedido',
    align: 'right',
    render: (faltante) => (
      <Typography component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {unidadesFaltantes(faltante.cantidad_faltante)}
      </Typography>
    ),
  },
  {
    clave: 'comprobante',
    encabezado: 'Comprobante',
    render: (faltante) => (
      <Typography
        component={RouterLink}
        to={`/ventas/comprobantes/${faltante.comprobante_id}`}
        sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
      >
        {faltante.comprobante}
      </Typography>
    ),
  },
  { clave: 'desde', encabezado: 'Desde', render: (faltante) => formatearCuando(faltante.desde) },
  {
    clave: 'stock',
    encabezado: 'Stock hoy',
    render: (faltante) => {
      const estado = estadoStockHoy(faltante.stock_estado)
      return (
        <Stack spacing={0} alignItems="flex-start">
          <EtiquetaEstado texto={estado.texto} variante={estado.variante} />
          <Typography component="span" variant="caption" color="text.secondary">
            {unidadesDisponibles(faltante.stock_disponible)}
          </Typography>
        </Stack>
      )
    },
  },
  {
    clave: 'aviso',
    encabezado: 'Aviso',
    render: (faltante) => {
      const aviso = etiquetaAviso(faltante)
      return <EtiquetaEstado texto={aviso.texto} variante={aviso.variante} />
    },
  },
]

// Pantalla «Ventas · Faltantes» (F-VTA-18, FR-044 y FR-046; F-VTA-26 y F-VTA-27). Los faltantes abiertos los
// registra el despacho (F-VTA-18, FR-047) desde el comprobante; acá se listan y, con `ventas` en edición, se
// avisa a los clientes (F-VTA-26) y se ven los marcados «Para avisar» al ingresar mercadería (F-VTA-27).
// La autoridad es la base
// (`listar_faltantes`: las empresas donde la persona tiene Ventas al menos en lectura); la pantalla
// solo acota por tienda y carga por tandas (carga infinita). La tienda sigue a la empresa activa de la barra superior.
export function FaltantesList() {
  const {
    empresas,
    valor: empresaId,
    cambiar: elegirEmpresa,
    cargando: cargandoTiendas,
    hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const { nivel: nivelVentas } = useNivelSeccion('ventas')
  const puedeAvisar = nivelVentas === 'edicion'
  const [pagina, setPagina] = useState(1)
  const [filtroAviso, setFiltroAviso] = useState<FiltroAviso>('todos')
  const [dialogo, setDialogo] = useState(false)
  const [mensaje, setMensaje] = useState(TEXTO_AVISO_POR_DEFECTO)
  const [reavisar, setReavisar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<AvisoEmergente | null>(null)

  const {
    ambito, faltantes, total, isLoading, isFetching, isError, refetch, elegidos, alternar, alternarTodos, avisar,
  } = useListarFaltantes({
    empresaId,
    pagina,
    tamano: TAMANO_PAGINA,
    aviso: filtroAviso === 'para_avisar' ? 'para_avisar' : undefined,
  })

  // Carga infinita (Principio VI): se suman las tandas que entrega el hook; cambiar de tienda o de filtro reinicia.
  const listado = useListadoAcumulado({
    items: faltantes,
    pagina,
    setPagina,
    total,
    cargando: isFetching,
    reinicio: `${ambito}|${filtroAviso}`,
  })
  const falloTanda = isError && pagina > 1
  const imagenes = useImagenesProductos(listado.filas.map((f) => f.producto_id))
  const columnas = armarColumnas({ imagenes, seleccion: puedeAvisar ? { elegidos, alternar } : undefined })

  const idsElegidos = Object.keys(elegidos)
  const cantidadElegidos = idsElegidos.length
  const clientesElegidos = new Set(Object.values(elegidos).map((e) => e.cliente)).size
  const yaAvisadosElegidos = Object.values(elegidos).filter((e) => e.avisado).length
  const todosElegidos = listado.filas.length > 0 && listado.filas.every((f) => elegidos[f.id])

  const abrirDialogo = () => {
    setMensaje(TEXTO_AVISO_POR_DEFECTO)
    setReavisar(false)
    setDialogo(true)
  }

  const enviar = async () => {
    if (enviando) return
    setEnviando(true)
    try {
      const clientePorId = Object.fromEntries(Object.entries(elegidos).map(([id, e]) => [id, e.cliente]))
      const resultado = await avisar(mensaje, reavisar)
      setDialogo(false)
      // Los avisos cambian filas de tandas anteriores: se recarga desde la primera.
      setPagina(1)
      // Si no se encoló ningún correo, el aviso no es un éxito: lo dice el texto y el color.
      setAviso({
        texto: mensajeResultadoAvisoVenta(resultado, clientePorId),
        severidad: resultado.encolados > 0 ? 'success' : 'warning',
      })
    } catch (error) {
      setAviso({ texto: error instanceof Error ? error.message : 'No pudimos enviar los avisos. Probá de nuevo.', severidad: 'error' })
    } finally {
      setEnviando(false)
    }
  }

  // Cambió el ámbito (organización + tienda): la pantalla se reencuadra (Principio VIII, FR-046). Se
  // ajusta en el MISMO render —no en un efecto— para que la paginación vuelva a la primera página sin
  // pedir la que ya no correspondía, y para que no se dibuje ni una fila de la empresa anterior: el
  // hook ata cada lectura a su ámbito y descarta lo que llegó de otra tienda.
  const [ambitoVisto, setAmbitoVisto] = useState(ambito)
  if (ambito !== ambitoVisto) {
    setAmbitoVisto(ambito)
    setPagina(1)
    // La selección vive en el hook atada al ámbito y se descarta sola; el diálogo abierto se cierra con
    // aviso para que nunca se envíe sobre la empresa nueva (FR-009).
    if (dialogo) {
      setDialogo(false)
      setAviso({ texto: 'Cambiaste de empresa: se cerró el aviso a los clientes.', severidad: 'info' })
    }
  }

  // Página fuera de rango (p. ej. se resolvió el último faltante de la última página): vuelve a la primera.
  // Se ajusta en el MISMO render —no en un efecto— para no dejar una pasada de render con la página vieja
  // (mismo criterio que el reencuadre por empresa de arriba).
  if (!isLoading && !isFetching && !isError && faltantes.length === 0 && pagina > 1) setPagina(1)

  return (
    <Box>
      <EncabezadoPagina
        titulo="Faltantes"
        descripcion="Líneas vendidas o pedidas sin stock."
        contexto={<ContextoOrganizacionActiva />}
        accion={
          puedeAvisar ? (
            <Button variant="contained" disabled={cantidadElegidos === 0 || cantidadElegidos > MAXIMO_AVISO_FALTANTES} onClick={abrirDialogo}>
              {`Avisar a los seleccionados (${cantidadElegidos})`}
            </Button>
          ) : undefined
        }
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(nuevo) => {
              elegirEmpresa(nuevo)
              setPagina(1)
            }}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda={AYUDA_FILTRO_TIENDA}
          />

          <BarraHerramientas
            contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'faltante' : 'faltantes'}`}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por aviso"
              value={filtroAviso}
              onChange={(_, valor: FiltroAviso | null) => {
                if (valor === null || valor === filtroAviso) return
                setFiltroAviso(valor)
                setPagina(1)
              }}
            >
              <ToggleButton value="todos">Todos</ToggleButton>
              <ToggleButton value="para_avisar">Para avisar</ToggleButton>
            </ToggleButtonGroup>
          </BarraHerramientas>

          {filtroAviso === 'para_avisar' ? (
            <Alert severity="info" role="note">
              Son faltantes de productos que ya ingresaron mercadería, del más antiguo al más nuevo. No se envía nada solo:
              elegí los que quieras y avisá a los clientes.
            </Alert>
          ) : null}

          {isFetching && !isLoading && pagina === 1 ? <LinearProgress aria-label="Actualizando los faltantes" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError && !falloTanda ? (
              <EstadoError descripcion="No pudimos cargar los faltantes." reintentar={() => void refetch()} />
            ) : listado.filas.length === 0 ? (
              filtroAviso === 'para_avisar' ? (
                <EstadoVacio
                  titulo="No hay faltantes para avisar"
                  descripcion="Cuando ingrese mercadería de un producto con faltantes abiertos, los vas a ver acá."
                />
              ) : (
                <EstadoVacio
                  titulo="Sin resultados"
                  descripcion="No hay faltantes abiertos en las tiendas que podés ver."
                />
              )
            ) : (
              <>
                <ContenidoAdaptable
                  items={listado.filas}
                  columnas={columnas}
                  obtenerClave={(faltante) => faltante.id}
                  etiquetaTabla="Faltantes"
                  seleccionEnCabecera={
                    puedeAvisar ? (
                      <Checkbox
                        checked={todosElegidos}
                        indeterminate={!todosElegidos && listado.filas.some((f) => elegidos[f.id])}
                        onChange={() => alternarTodos(listado.filas)}
                        slotProps={{ input: { 'aria-label': 'Seleccionar todos' } }}
                      />
                    ) : undefined
                  }
                />
                <CargaInfinita hayMas={listado.hayMas} cargando={listado.cargandoMas} hayError={falloTanda} onCargarMas={falloTanda ? () => void refetch() : listado.cargarMas} />
                {puedeAvisar ? (
                  <Typography variant="xs" component="p" sx={{ mt: 1 }}>
                    {`${cantidadElegidos} ${cantidadElegidos === 1 ? 'seleccionado' : 'seleccionados'} de ${total} ${total === 1 ? 'faltante' : 'faltantes'}.`}
                    {cantidadElegidos > MAXIMO_AVISO_FALTANTES
                      ? ` Se avisa de a ${MAXIMO_AVISO_FALTANTES} por vez: desmarcá ${cantidadElegidos - MAXIMO_AVISO_FALTANTES} para poder enviar.`
                      : ''}
                  </Typography>
                ) : null}
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      <Dialog open={dialogo} onClose={() => (enviando ? undefined : setDialogo(false))} aria-labelledby="titulo-avisar-faltantes" fullWidth maxWidth="sm">
        <DialogTitle id="titulo-avisar-faltantes">Avisar a los clientes</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              {`Se envía un correo a ${clientesElegidos} ${clientesElegidos === 1 ? 'cliente' : 'clientes'} con el detalle de los productos que volvieron a tener stock. Los faltantes avisados quedan marcados y no se vuelven a avisar.`}
            </DialogContentText>
            <TextField
              label="Texto del aviso"
              multiline
              minRows={3}
              fullWidth
              value={mensaje}
              onChange={(evento) => setMensaje(evento.target.value)}
              disabled={enviando}
              helperText={`${mensaje.length} / ${MAXIMO_MENSAJE_AVISO}`}
              slotProps={{ htmlInput: { maxLength: MAXIMO_MENSAJE_AVISO } }}
            />
            {yaAvisadosElegidos > 0 ? (
              <FormControlLabel
                control={<Checkbox checked={reavisar} onChange={(evento) => setReavisar(evento.target.checked)} disabled={enviando} />}
                label={`Volver a avisar a los ${yaAvisadosElegidos} ya avisados`}
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogo(false)} disabled={enviando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void enviar()} disabled={enviando}>Enviar avisos</Button>
        </DialogActions>
      </Dialog>

      {/* El aviso largo (con lo omitido) y los errores quedan hasta que se cierren: se leen con calma y con lector de pantalla. */}
      <Snackbar open={aviso !== null} autoHideDuration={aviso && aviso.severidad === 'success' && aviso.texto.length <= 40 ? 5000 : null} onClose={() => setAviso(null)}>
        <Alert severity={aviso?.severidad ?? 'success'} onClose={() => setAviso(null)}>{aviso?.texto}</Alert>
      </Snackbar>
    </Box>
  )
}
