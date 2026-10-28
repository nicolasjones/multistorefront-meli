import { useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, LinearProgress, Link, Snackbar, Stack, Tab, TablePagination, Tabs, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { useRma } from '../../hooks/useRma'
import { definicionEstadoRma } from '../../lib/estadoRma'
import { definicionForma, type FormaRma } from '../../lib/formasRma'
import { MENSAJE_RMA_REGISTRADA, TAMANO_PAGINA_RMA, type RmaListado } from '../../lib/rma'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { DialogoNuevaDevolucion } from '../../components/ventas/DialogoNuevaDevolucion'

const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const TEXTO_AYUDA_TIENDA = 'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'
const AVISO_CAMBIO_DE_TIENDA = 'Cambiaste de tienda: cerramos la devolución que estabas cargando. Volvé a abrirla para la nueva tienda.'

// «07/10»: día y mes con dos dígitos (en-GB, porque es-AR omite el cero) en hora argentina, como el prototipo.
const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })

const columnas: ColumnaAdaptable<RmaListado>[] = [
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
      return <EtiquetaEstado texto={forma.etiqueta} variante={forma.tono} />
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
      return <EtiquetaEstado texto={estado.etiqueta} variante={estado.tono} />
    },
  },
]

// Pantalla Devoluciones (RMA) (F-VTA-28, MSF-288, FR-004…FR-008): VentasDevoluciones.dc.html. Lista las devoluciones y
// reclamos por ítem de las tiendas accesibles, paginado en el servidor, con el filtro Tienda (`FiltroEmpresa`, que sigue a
// la empresa activa) y el diálogo «Nueva devolución». El filtro por forma y el avance de estado son de F-VTA-29; el vínculo
// con la nota de crédito y el stock, de F-VTA-30. Las pestañas Pagos, Faltantes y Transportes son de otras épicas.
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
  const { pagina, setPagina, datos, cargando, primeraCarga, hayError, recargar } = useRma(empresaId)
  const [registrada, setRegistrada] = useState<FormaRma | null>(null)

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

          <BarraHerramientas contador={primeraCarga || hayError ? undefined : `${datos.total} ${datos.total === 1 ? 'devolución' : 'devoluciones'}`} />

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
              <EstadoVacio titulo="Sin devoluciones" descripcion="No hay registros con esa forma de RMA." accion={nueva} />
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

      <Snackbar open={registrada !== null} autoHideDuration={4000} onClose={() => setRegistrada(null)}>
        <Alert severity="success" onClose={() => setRegistrada(null)}>{registrada ? MENSAJE_RMA_REGISTRADA(registrada) : ''}</Alert>
      </Snackbar>
    </Box>
  )
}
