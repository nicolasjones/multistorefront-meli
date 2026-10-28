import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, LinearProgress, Link, Snackbar, Stack, Tab, TablePagination, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { useRma } from '../../hooks/useRma'
import { definicionEstadoRma, siguienteEstadoRma } from '../../lib/estadoRma'
import { definicionForma, FORMAS_RMA, type FormaRma } from '../../lib/formasRma'
import {
  cambiarEstadoRma, MENSAJE_ESTADO_RMA_CAMBIADO, MENSAJE_NOTA_RMA_VINCULADA, MENSAJE_RMA_REGISTRADA,
  MENSAJE_STOCK_RMA_REINGRESADO, mensajeDeCambioEstadoRma, TAMANO_PAGINA_RMA, type RmaListado,
} from '../../lib/rma'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { DialogoNuevaDevolucion } from '../../components/ventas/DialogoNuevaDevolucion'
import { DialogoResolverRma, type ModoResolucion } from '../../components/ventas/DialogoResolverRma'

const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const TEXTO_AYUDA_TIENDA = 'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'
const AVISO_CAMBIO_DE_TIENDA = 'Cambiaste de tienda: cerramos la devolución que estabas cargando. Volvé a abrirla para la nueva tienda.'

// «07/10»: día y mes con dos dígitos (en-GB, porque es-AR omite el cero) en hora argentina, como el prototipo.
const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

const TODAS_LAS_FORMAS = 'todas'
const MENSAJE_SIN_FORMA = 'No hay registros con esa forma de RMA.'

type AccionEstado = {
  puedeEditar: boolean
  pendienteId: string | null
  onAvanzar: (r: RmaListado) => void
  onResolver: (r: RmaListado, modo: ModoResolucion) => void
}

// «Pasar a En gestión» / «Cerrar»: la acción nombra el estado al que se llega. Con la devolución ya cerrada no hay
// transición posible y la acción queda deshabilitada (FR-012).
const ETIQUETA_AVANCE = { en_gestion: 'Pasar a En gestión', cerrado: 'Cerrar' } as const

const armarColumnas = ({ puedeEditar, pendienteId, onAvanzar, onResolver }: AccionEstado): ColumnaAdaptable<RmaListado>[] => [
  {
    clave: 'rma', encabezado: 'RMA',
    render: (r) => (
      <Stack spacing={0}>
        <Typography component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.numero}</Typography>
        <Typography component="span" variant="xs">{fechaCorta(r.creado_en)}</Typography>
      </Stack>
    ),
  },
  { clave: 'tienda', encabezado: 'Tienda', render: (r) => <EtiquetaEstado texto={r.empresa} variante="contorno" /> },
  {
    clave: 'comprobante', encabezado: 'Comprobante',
    render: (r) => (
      <Link component={RouterLink} to={`/ventas/comprobantes/${r.comprobante_id}`} underline="hover" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {r.comprobante_numero}
      </Link>
    ),
  },
  { clave: 'cliente', encabezado: 'Cliente', render: (r) => <Typography component="span" sx={{ fontWeight: 600 }}>{r.cliente}</Typography> },
  {
    clave: 'producto', encabezado: 'Producto',
    render: (r) => (
      <span>
        {r.producto} <Typography component="span" variant="xs" sx={{ whiteSpace: 'nowrap' }}>×{r.cantidad}</Typography>
      </span>
    ),
  },
  {
    clave: 'forma', encabezado: 'Forma de RMA',
    render: (r) => {
      const forma = definicionForma(r.forma_rma)
      return (
        <Stack spacing={0.5} alignItems="flex-start">
          <EtiquetaEstado texto={forma.etiqueta} variante={forma.tono} />
          {r.nota_credito_id ? (
            <Link component={RouterLink} to={`/ventas/comprobantes/${r.nota_credito_id}`} underline="hover" variant="body2" sx={{ whiteSpace: 'nowrap' }}>
              Nota de crédito {r.nota_credito_numero}
            </Link>
          ) : null}
          {r.stock_reingresado ? <Typography component="span" variant="xs">Stock reingresado</Typography> : null}
        </Stack>
      )
    },
  },
  {
    clave: 'motivo', encabezado: 'Motivo / operador',
    render: (r) => (
      <Stack spacing={0}>
        <span>{r.motivo}</span>
        <Typography component="span" variant="xs">{r.operador}</Typography>
      </Stack>
    ),
  },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (r) => {
      const estado = definicionEstadoRma(r.estado)
      const siguiente = siguienteEstadoRma(r.estado)
      const sinResolver = !r.nota_credito_id && !r.stock_reingresado
      // La forma elige el mecanismo (spec, Decisiones abiertas 6): importe → nota de crédito; las físicas → reingreso.
      const modoResolucion: ModoResolucion = r.forma_rma === 'devolucion_importe' ? 'nota' : 'stock'
      return (
        <Stack spacing={0.5} alignItems="flex-start">
          <EtiquetaEstado texto={estado.etiqueta} variante={estado.tono} />
          {puedeEditar ? (
            <Button
              size="small"
              variant="outlined"
              disabled={siguiente === null || pendienteId === r.id}
              onClick={() => onAvanzar(r)}
              aria-label={siguiente === null
                ? `Devolución ${r.numero}: ya está cerrada`
                : `${ETIQUETA_AVANCE[siguiente]}: devolución ${r.numero}`}
            >
              {siguiente === null ? 'Cerrada' : ETIQUETA_AVANCE[siguiente]}
            </Button>
          ) : null}
          {puedeEditar && sinResolver ? (
            <Button
              size="small"
              variant="text"
              disabled={pendienteId === r.id}
              onClick={() => onResolver(r, modoResolucion)}
              aria-label={`${modoResolucion === 'nota' ? 'Emitir nota de crédito' : 'Reingresar stock'}: devolución ${r.numero}`}
            >
              {modoResolucion === 'nota' ? 'Emitir nota de crédito' : 'Reingresar stock'}
            </Button>
          ) : null}
        </Stack>
      )
    },
  },
]

// Pantalla Devoluciones (RMA) (F-VTA-28, MSF-288, FR-004…FR-008): VentasDevoluciones.dc.html. Lista las devoluciones y
// reclamos por ítem de las tiendas accesibles, paginado en el servidor, con el filtro Tienda (`FiltroEmpresa`, que sigue a
// la empresa activa) y el diálogo «Nueva devolución». F-VTA-29 agrega el filtro por forma de RMA (chips «Todas» + las
// cinco formas, en servidor), el contador y el avance de estado Abierta → En gestión → Cerrada para quien edita; el
// F-VTA-30 agrega la resolución: emitir la nota de crédito (forma «Devolución de importe») o reingresar el stock (las demás) y mostrar el vínculo. Las pestañas Pagos, Faltantes y Transportes son de otras épicas.
export function DevolucionesList() {
  const { empresas, valor, cambiar, cargando, hayError } = useFiltroPorEmpresaActiva()
  const { organizacionActiva } = useOrganizacionActiva()
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [avisoCambio, setAvisoCambio] = useState(false)

  // El diálogo vive acá (el listado se remonta al cambiar de tienda): si se cambia de tienda con la devolución a medio
  // cargar, se cierra con aviso y jamás se guarda lo cargado bajo la nueva tienda (Principio VIII).
  const claveTienda = `${organizacionActiva?.id ?? ''}:${valor ?? ''}`
  const [claveVista, setClaveVista] = useState(claveTienda)
  if (claveVista !== claveTienda) {
    setClaveVista(claveTienda)
    if (dialogoAbierto) {
      setDialogoAbierto(false)
      setAvisoCambio(true)
    }
  }

  return (
    <ListadoDevoluciones
      key={claveTienda}
      dialogoAbierto={dialogoAbierto}
      onDialogo={setDialogoAbierto}
      avisoCambio={avisoCambio}
      onCerrarAviso={() => setAvisoCambio(false)}
      tiendas={empresas}
      empresaId={valor ?? ''}
      onEmpresa={cambiar}
      cargandoTiendas={cargando}
      errorTiendas={hayError}
    />
  )
}

type PropsListado = {
  dialogoAbierto: boolean
  onDialogo: (abierto: boolean) => void
  avisoCambio: boolean
  onCerrarAviso: () => void
  tiendas: ReadonlyArray<{ id: string; nombre: string }>
  empresaId: string
  onEmpresa: (id: string | null) => void
  cargandoTiendas: boolean
  errorTiendas: boolean
}

function ListadoDevoluciones({ dialogoAbierto, onDialogo, avisoCambio, onCerrarAviso, tiendas, empresaId, onEmpresa, cargandoTiendas, errorTiendas }: PropsListado) {
  const { nivel } = useNivelSeccion('ventas')
  const puedeCrear = nivel === 'edicion'
  const [formaRma, setFormaRma] = useState('')
  const { pagina, setPagina, datos, cargando, primeraCarga, hayError, recargar } = useRma(empresaId, formaRma)
  const [registrada, setRegistrada] = useState<FormaRma | null>(null)
  const [pendienteId, setPendienteId] = useState<string | null>(null)
  const [avisoEstado, setAvisoEstado] = useState<{ severidad: 'success' | 'error'; texto: string } | null>(null)

  const avanzar = async (r: RmaListado) => {
    const siguiente = siguienteEstadoRma(r.estado)
    if (siguiente === null || pendienteId !== null) return
    setPendienteId(r.id)
    try {
      const cambiada = await cambiarEstadoRma(r.id, siguiente, r.actualizado_en)
      setAvisoEstado({ severidad: 'success', texto: MENSAJE_ESTADO_RMA_CAMBIADO(r.numero, cambiada.estado) })
    } catch (error) {
      setAvisoEstado({ severidad: 'error', texto: mensajeDeCambioEstadoRma(error) })
    } finally {
      setPendienteId(null)
    }
    // Éxito o error, el listado se vuelve a leer: nunca queda un estado o un sello viejo en pantalla.
    void recargar()
  }
  const [resolviendo, setResolviendo] = useState<{ rma: RmaListado; modo: ModoResolucion } | null>(null)
  const columnas = armarColumnas({
    puedeEditar: puedeCrear, pendienteId, onAvanzar: (r) => void avanzar(r),
    onResolver: (r, modo) => setResolviendo({ rma: r, modo }),
  })

  const nueva = puedeCrear
    ? <Button variant="contained" onClick={() => onDialogo(true)}>Nueva devolución</Button>
    : undefined

  return (
    <Box>
      <EncabezadoPagina
        titulo="Devoluciones (RMA)"
        descripcion="Devoluciones y reclamos por ítem: cambio, envío a proveedor, faltante en envío y devolución de importe."
        accion={nueva}
        contexto={<ContextoOrganizacionActiva />}
        pestanas={(
          <Tabs value={2} aria-label="Secciones de Ventas">
            <Tab component={RouterLink} to="/ventas/comprobantes" label="Comprobantes" />
            <Tab component={RouterLink} to="/ventas/presupuestos" label="Presupuestos" />
            <Tab component={RouterLink} to="/ventas/devoluciones" label="Devoluciones (RMA)" />
          </Tabs>
        )}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {avisoCambio ? <Alert severity="info" role="status" onClose={onCerrarAviso}>{AVISO_CAMBIO_DE_TIENDA}</Alert> : null}

          <FiltroEmpresa
            empresas={tiendas}
            valor={empresaId === '' ? null : empresaId}
            onCambiar={(id) => { onEmpresa(id); setPagina(1) }}
            textoAyuda={TEXTO_AYUDA_TIENDA}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
          />

          <BarraHerramientas
            contador={primeraCarga || hayError ? undefined : `${datos.total} ${datos.total === 1 ? 'devolución' : 'devoluciones'}`}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por forma de RMA"
              value={formaRma === '' ? TODAS_LAS_FORMAS : formaRma}
              onChange={(_, nuevo: string | null) => { if (nuevo !== null) setFormaRma(nuevo === TODAS_LAS_FORMAS ? '' : nuevo) }}
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value={TODAS_LAS_FORMAS}>Todas</ToggleButton>
              {FORMAS_RMA.map((forma) => <ToggleButton key={forma.valor} value={forma.valor}>{forma.etiqueta}</ToggleButton>)}
            </ToggleButtonGroup>
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {primeraCarga || hayError ? '' : `${datos.total} ${datos.total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {cargando && !primeraCarga ? <LinearProgress aria-label="Actualizando devoluciones" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={cargando}>
            {primeraCarga ? (
              <EstadoCargaPagina />
            ) : hayError ? (
              <EstadoError descripcion="No pudimos cargar las devoluciones." reintentar={() => void recargar()} />
            ) : datos.devoluciones.length === 0 && pagina === 1 ? (
              <EstadoVacio
                titulo="Sin devoluciones"
                descripcion={formaRma === '' ? 'Todavía no registraste devoluciones.' : MENSAJE_SIN_FORMA}
                accion={formaRma === '' ? nueva : undefined}
              />
            ) : (
              <>
                <ContenidoAdaptable
                  items={datos.devoluciones}
                  columnas={columnas}
                  obtenerClave={(r) => r.id}
                  etiquetaTabla="Devoluciones"
                />
                <TablePagination
                  component="div"
                  count={datos.total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA_RMA}
                  rowsPerPageOptions={[TAMANO_PAGINA_RMA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Devoluciones por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                />
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      {puedeCrear ? (
        <DialogoNuevaDevolucion
          open={dialogoAbierto}
          empresaId={empresaId}
          onCerrar={() => onDialogo(false)}
          onRegistrada={(forma) => {
            onDialogo(false)
            setRegistrada(forma)
            setPagina(1)
            void recargar()
          }}
        />
      ) : null}

      {puedeCrear ? (
        <DialogoResolverRma
          rma={resolviendo?.rma ?? null}
          modo={resolviendo?.modo ?? 'nota'}
          onCerrar={() => setResolviendo(null)}
          onResuelta={(r, modo) => {
            setResolviendo(null)
            setAvisoEstado({ severidad: 'success', texto: modo === 'nota' ? MENSAJE_NOTA_RMA_VINCULADA(r.numero) : MENSAJE_STOCK_RMA_REINGRESADO(r.numero) })
            void recargar()
          }}
        />
      ) : null}

      <Snackbar open={avisoEstado !== null} autoHideDuration={5000} onClose={() => setAvisoEstado(null)}>
        <Alert severity={avisoEstado?.severidad ?? 'success'} onClose={() => setAvisoEstado(null)}>{avisoEstado?.texto ?? ''}</Alert>
      </Snackbar>

      <Snackbar open={registrada !== null} autoHideDuration={4000} onClose={() => setRegistrada(null)}>
        <Alert severity="success" onClose={() => setRegistrada(null)}>{registrada ? MENSAJE_RMA_REGISTRADA(registrada) : ''}</Alert>
      </Snackbar>
    </Box>
  )
}
