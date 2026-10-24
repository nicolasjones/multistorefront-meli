import { Link as RouterLink, useLocation } from 'react-router'
import { Alert, Box, Button, LinearProgress, Link, Stack, Tab, TablePagination, Tabs, TextField, Typography } from '@mui/material'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import { useComprobantes, useOpcionesFiltrosComprobantes } from '../../hooks/useComprobantes'
import { useExportarComprobantes } from '../../hooks/useExportarComprobantes'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import { ETIQUETA_TIPO_LISTADO, OPCIONES_FILTRO_ESTADO, type ComprobanteListado } from '../../lib/ventasComprobantes'
import { definicionEstado } from '../../lib/estadosComprobante'
import { formatearFecha, formatearImporteHistorial } from '../../lib/formatoHistorial'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { FiltroDesplegable } from '../../components/ventas/FiltroDesplegable'

const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const TEXTO_AYUDA_TIENDA = 'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'

const columnaTipo = (c: ComprobanteListado) => {
  const tipo = ETIQUETA_TIPO_LISTADO[c.tipo] ?? c.tipo
  return <Typography component="span" variant="xs">{tipo}</Typography>
}

const columnas: ColumnaAdaptable<ComprobanteListado>[] = [
  {
    clave: 'numero', encabezado: 'Comprobante',
    render: (c) => (
      <Stack spacing={0}>
        <Link component={RouterLink} to={`/ventas/comprobantes/${c.id}`} underline="hover" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {c.numero}
        </Link>
        {columnaTipo(c)}
      </Stack>
    ),
  },
  { clave: 'tienda', encabezado: 'Tienda', render: (c) => <EtiquetaEstado texto={c.empresa} variante="contorno" /> },
  { clave: 'fecha', encabezado: 'Fecha', render: (c) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatearFecha(c.fecha)}</span> },
  { clave: 'cliente', encabezado: 'Cliente', render: (c) => <Typography component="span" sx={{ fontWeight: 600 }}>{c.cliente}</Typography> },
  { clave: 'operador', encabezado: 'Operador', render: (c) => c.operador },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (c) => {
      const estado = definicionEstado(c.estado)
      return <EtiquetaEstado texto={estado.etiqueta} variante={estado.tono} />
    },
  },
  { clave: 'pago', encabezado: 'Pago', render: (c) => c.forma_pago ?? '—' },
  { clave: 'envio', encabezado: 'Envío', render: (c) => c.envio ?? '—' },
  { clave: 'total', encabezado: 'Total', align: 'right', render: (c) => <b style={{ whiteSpace: 'nowrap' }}>{formatearImporteHistorial(c.total)}</b> },
]

// Pantalla Comprobantes (F-VTA-09, MSF-346, FR-001…FR-010): VentasComprobantes.dc.html. Lista facturas y notas
// de crédito de las tiendas accesibles, paginado en el servidor, con búsqueda sin esperas del lado del cliente,
// filtros Operador/Estado/Pago/Envío y Tienda (`FiltroEmpresa`, que sigue a la empresa activa), «Limpiar filtros»
// y «Exportar» (inmediata hasta 10.000 filas; diferida por encima). Las pestañas Pagos, Faltantes, Devoluciones y
// Transportes y las tarjetas KPI son de otras historias (matriz pantalla↔criterios).
export function ComprobantesList() {
  const { empresas, valor, cambiar, cargando, hayError } = useFiltroPorEmpresaActiva()
  const { organizacionActiva } = useOrganizacionActiva()
  return (
    <ListadoComprobantes
      key={`${organizacionActiva?.id ?? ''}:${valor ?? ''}`}
      tiendas={empresas}
      empresaId={valor ?? ''}
      onEmpresa={cambiar}
      cargandoTiendas={cargando}
      errorTiendas={hayError}
    />
  )
}

type PropsListado = {
  tiendas: ReadonlyArray<{ id: string; nombre: string }>
  empresaId: string
  onEmpresa: (id: string | null) => void
  cargandoTiendas: boolean
  errorTiendas: boolean
}

function ListadoComprobantes({ tiendas, empresaId, onEmpresa, cargandoTiendas, errorTiendas }: PropsListado) {
  const ubicacion = useLocation()
  const { nivel } = useNivelSeccion('ventas')
  const puedeCrear = nivel === 'edicion'
  const puedeExportar = usePuedeAccion('ventas', 'exportar').puede === true
  const { texto, setTexto, filtros, elegir, limpiar, pagina, setPagina, datos, cargando, primeraCarga, hayError, recargar } = useComprobantes(empresaId)
  const opciones = useOpcionesFiltrosComprobantes(empresaId, tiendas)
  const { exportando, exportar, aviso, cerrarAviso } = useExportarComprobantes('comprobantes', filtros, datos.total)

  const hayFiltros = filtros.busqueda.trim() !== '' || filtros.estado !== '' || filtros.pagoId !== '' || filtros.envioId !== '' || filtros.operadorId !== ''
  const pestana = ubicacion.pathname.startsWith('/ventas/presupuestos') ? 1 : 0

  const nuevo = puedeCrear
    ? <Button variant="contained" component={RouterLink} to="/ventas/comprobantes/nuevo">Nuevo comprobante</Button>
    : undefined
  const exportarBoton = puedeExportar
    ? (
      <Button variant="outlined" startIcon={<FileDownloadIcon />} onClick={() => void exportar()} disabled={exportando || primeraCarga || hayError}>
        {exportando ? 'Exportando…' : 'Exportar'}
      </Button>
    )
    : undefined

  return (
    <Box>
      <EncabezadoPagina
        titulo="Comprobantes"
        descripcion="Facturas y remitos de ventas internas: mostrador, teléfono, WhatsApp y pedidos de la tienda web."
        accion={<>{exportarBoton}{nuevo}</>}
        contexto={<ContextoOrganizacionActiva />}
        pestanas={(
          <Tabs value={pestana} aria-label="Secciones de Ventas">
            <Tab component={RouterLink} to="/ventas/comprobantes" label="Comprobantes" />
            <Tab component={RouterLink} to="/ventas/presupuestos" label="Presupuestos" />
          </Tabs>
        )}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <FiltroEmpresa
            empresas={tiendas}
            valor={empresaId === '' ? null : empresaId}
            onCambiar={(id) => { onEmpresa(id); setPagina(1) }}
            textoAyuda={TEXTO_AYUDA_TIENDA}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
          />

          {aviso ? (
            <Alert
              severity={aviso.severidad}
              role="status"
              onClose={cerrarAviso}
              action={aviso.accion ? <Button color="inherit" size="small" onClick={aviso.accion.onClick}>{aviso.accion.texto}</Button> : undefined}
            >
              {aviso.texto}
            </Alert>
          ) : null}

          <BarraHerramientas contador={primeraCarga || hayError ? undefined : `${datos.total} ${datos.total === 1 ? 'comprobante' : 'comprobantes'}`}>
            <TextField
              type="search"
              label="Buscar por cliente o número"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ width: 280, maxWidth: '100%' }}
            />
            <FiltroDesplegable etiqueta="Operador" valor={filtros.operadorId} opciones={opciones.operadores.map((o) => ({ valor: o.id, etiqueta: o.nombre }))} onCambiar={(v) => elegir('operadorId', v)} />
            <FiltroDesplegable etiqueta="Estado" valor={filtros.estado} opciones={OPCIONES_FILTRO_ESTADO} onCambiar={(v) => elegir('estado', v)} />
            <FiltroDesplegable etiqueta="Pago" valor={filtros.pagoId} opciones={opciones.pagos.map((o) => ({ valor: o.id, etiqueta: o.nombre }))} onCambiar={(v) => elegir('pagoId', v)} />
            <FiltroDesplegable etiqueta="Envío" valor={filtros.envioId} opciones={opciones.envios.map((o) => ({ valor: o.id, etiqueta: o.nombre }))} onCambiar={(v) => elegir('envioId', v)} />
            {hayFiltros ? <Button size="small" variant="text" onClick={limpiar}>Limpiar filtros</Button> : null}
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {primeraCarga || hayError ? '' : `${datos.total} ${datos.total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {cargando && !primeraCarga ? <LinearProgress aria-label="Actualizando comprobantes" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={cargando}>
            {primeraCarga ? (
              <EstadoCargaPagina />
            ) : hayError ? (
              <EstadoError descripcion="No pudimos cargar los comprobantes." reintentar={() => void recargar()} />
            ) : datos.comprobantes.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="Sin resultados" descripcion="Probá con otra búsqueda o limpiá los filtros." />
              ) : (
                <EstadoVacio titulo="Todavía no hay comprobantes." descripcion={puedeCrear ? 'Creá el primero con «Nuevo comprobante».' : undefined} accion={nuevo} />
              )
            ) : (
              <>
                <ContenidoAdaptable
                  items={datos.comprobantes}
                  columnas={columnas}
                  obtenerClave={(c) => c.id}
                  etiquetaTabla="Comprobantes"
                  varianteFila={(c) => (c.total < 0 ? 'negativa' : undefined)}
                />
                <TablePagination
                  component="div"
                  count={datos.total}
                  page={pagina - 1}
                  rowsPerPage={12}
                  rowsPerPageOptions={[12]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Comprobantes por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                />
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>
    </Box>
  )
}
