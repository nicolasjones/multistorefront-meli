import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router'
import { Alert, Box, Button, LinearProgress, Link, Stack, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import { useExportarComprobantes } from '../../hooks/useExportarComprobantes'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import {
  FILTROS_ESTADO,
  aceptarPresupuesto,
  copiarPresupuesto,
  etiquetaEstadoPresupuesto,
  listarPresupuestos,
  puedeAceptarOModificarPresupuesto,
  puedeCopiarPresupuesto,
  varianteEstadoPresupuesto,
  type FiltroEstadoPresupuesto,
  type PaginaPresupuestos,
  type Presupuesto,
} from '../../lib/ventasPresupuestos'
import { mensajeDeErrorComprobante } from '../../lib/ventas'
import type { FiltrosComprobantes } from '../../lib/ventasComprobantes'
import { formatearFecha, formatearImporteHistorial } from '../../lib/formatoHistorial'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 25
const ESPERA_BUSQUEDA_MS = 300
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const PAGINA_VACIA: PaginaPresupuestos = { presupuestos: [], total: 0 }
const TEXTO_AYUDA_TIENDA = 'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'

const columnas: ColumnaAdaptable<Presupuesto>[] = [
  {
    clave: 'numero', encabezado: 'Presupuesto',
    render: (p) => (
      <Link component={RouterLink} to={`/ventas/comprobantes/${p.id}`} underline="hover" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {p.numero}
      </Link>
    ),
  },
  { clave: 'tienda', encabezado: 'Tienda', render: (p) => <EtiquetaEstado texto={p.empresa} variante="contorno" /> },
  { clave: 'fecha', encabezado: 'Fecha', render: (p) => formatearFecha(p.fecha) },
  { clave: 'cliente', encabezado: 'Cliente', render: (p) => <Typography component="span" sx={{ fontWeight: 600 }}>{p.cliente}</Typography> },
  { clave: 'operador', encabezado: 'Operador', render: (p) => p.operador },
  { clave: 'valido_hasta', encabezado: 'Válido hasta', render: (p) => (p.valido_hasta ? formatearFecha(p.valido_hasta) : '—') },
  { clave: 'estado', encabezado: 'Estado', render: (p) => <EtiquetaEstado texto={etiquetaEstadoPresupuesto(p.estado)} variante={varianteEstadoPresupuesto(p.estado)} /> },
  { clave: 'total', encabezado: 'Total', align: 'right', render: (p) => <b>{formatearImporteHistorial(p.total)}</b> },
]

// Pantalla Presupuestos (F-VTA-08, FR-053/FR-054): VentasPresupuestos.dc.html. Lista, busca y filtra; por fila
// ofrece Aceptar, Copiar y Modificar según el estado. Fuera de alcance (matriz pantalla↔criterios): Exportar,
// Enviar por correo, Imprimir y Facturar, las demás pestañas de Ventas y el aviso de conversión a factura.
// Con la empresa activa de la barra superior el filtro de tienda la sigue y, al cambiarla, la pantalla se remonta:
// vuelve a la página 1, limpia búsqueda y mensajes y recarga todo (Constitución VIII).
export function PresupuestosList() {
  const { empresas, valor, cambiar, empresaActivaId } = useFiltroPorEmpresaActiva()
  const { organizacionActiva } = useOrganizacionActiva()
  return (
    <ListadoPresupuestos
      key={`${organizacionActiva?.id ?? ''}:${empresaActivaId ?? ''}`}
      tiendas={empresas}
      empresaId={valor ?? ''}
      onEmpresa={(id) => cambiar(id === '' ? null : id)}
    />
  )
}

type Accion = { id: string; tipo: 'aceptar' | 'copiar' }

function ListadoPresupuestos({ tiendas, empresaId, onEmpresa }: { tiendas: ReadonlyArray<{ id: string; nombre: string }>; empresaId: string; onEmpresa: (id: string) => void }) {
  const navigate = useNavigate()
  const { nivel } = useNivelSeccion('ventas')
  const puedeCrear = nivel === 'edicion'
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [estado, setEstado] = useState<FiltroEstadoPresupuesto>('todos')
  const [pagina, setPagina] = useState(1)
  const [datos, setDatos] = useState<PaginaPresupuestos>(PAGINA_VACIA)
  const [cargando, setCargando] = useState(true)
  const [primeraCarga, setPrimeraCarga] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [accion, setAccion] = useState<Accion | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  // La búsqueda espera a que se deje de tipear y vuelve a la primera página.
  useEffect(() => {
    if (texto === textoAplicado) return
    const espera = setTimeout(() => {
      setTextoAplicado(texto)
      setPagina(1)
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  // «Última petición gana»: una respuesta vieja no pisa a la nueva.
  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    try {
      const resultado = await listarPresupuestos({ busqueda: textoAplicado, estado, empresaId: empresaId === '' ? null : empresaId, pagina, tamano: TAMANO_PAGINA })
      if (peticion !== ultimaPeticion.current) return
      setDatos(resultado)
      setHayError(false)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      console.error('No pudimos listar los presupuestos.', error)
      setDatos(PAGINA_VACIA)
      setHayError(true)
    }
    setCargando(false)
    setPrimeraCarga(false)
  }, [textoAplicado, estado, empresaId, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const { presupuestos, total } = datos
  // Página fuera de rango (p. ej. se filtró estando en la última página): vuelve a la primera.
  useEffect(() => {
    if (!primeraCarga && !cargando && !hayError && presupuestos.length === 0 && pagina > 1) setPagina(1)
  }, [primeraCarga, cargando, hayError, presupuestos.length, pagina])

  const hayFiltros = textoAplicado.trim() !== '' || estado !== 'todos' || empresaId !== ''

  // Exportar (F-VTA-09, FR-006/FR-010): mismos filtros que el listado y la vía según el total. Los filtros de
  // cobro y envío no aplican a presupuestos; se envían vacíos.
  const filtrosExportacion: FiltrosComprobantes = {
    busqueda: textoAplicado, estado: estado === 'todos' ? '' : estado, pagoId: '', envioId: '', operadorId: '', empresaId,
  }
  const puedeExportar = usePuedeAccion('ventas', 'exportar').puede === true
  const { exportando, exportar, aviso, cerrarAviso } = useExportarComprobantes('presupuestos', filtrosExportacion, total)

  async function aceptar(p: Presupuesto) {
    setAccion({ id: p.id, tipo: 'aceptar' })
    setErrorAccion(null)
    setExito(null)
    try {
      const aceptado = await aceptarPresupuesto(p.id)
      setExito(`Presupuesto ${aceptado.numero} aceptado`)
      await cargar()
    } catch (error) {
      setErrorAccion(mensajeDeErrorComprobante(error, 'No pudimos aceptar el presupuesto.'))
    } finally {
      setAccion(null)
    }
  }

  async function copiar(p: Presupuesto) {
    setAccion({ id: p.id, tipo: 'copiar' })
    setErrorAccion(null)
    setExito(null)
    try {
      const copia = await copiarPresupuesto(p.id)
      navigate(`/ventas/comprobantes/${copia.id}`, { state: { mensaje: `Copiaste el presupuesto ${p.numero}: creamos el ${copia.numero}, listo para editar` } })
    } catch (error) {
      setErrorAccion(mensajeDeErrorComprobante(error, 'No pudimos copiar el presupuesto.'))
      setAccion(null)
    }
  }

  const ocupado = accion !== null
  const acciones = (p: Presupuesto) => {
    if (!p.puede_editar) return null
    return (
      <Stack direction="row" spacing={0.5} justifyContent="flex-end" useFlexGap flexWrap="wrap">
        <Button size="small" variant="outlined" disabled={ocupado || !puedeAceptarOModificarPresupuesto(p)} onClick={() => void aceptar(p)} aria-label={`Aceptar ${p.numero}`}>
          {accion?.id === p.id && accion.tipo === 'aceptar' ? 'Aceptando…' : 'Aceptar'}
        </Button>
        <Button size="small" variant="outlined" disabled={ocupado || !puedeCopiarPresupuesto(p)} onClick={() => void copiar(p)} aria-label={`Copiar ${p.numero}`}>
          {accion?.id === p.id && accion.tipo === 'copiar' ? 'Copiando…' : 'Copiar'}
        </Button>
        {puedeAceptarOModificarPresupuesto(p) && !ocupado ? (
          <Button size="small" variant="outlined" component={RouterLink} to={`/ventas/comprobantes/${p.id}`} aria-label={`Modificar ${p.numero}`}>Modificar</Button>
        ) : (
          <Button size="small" variant="outlined" disabled aria-label={`Modificar ${p.numero}`}>Modificar</Button>
        )}
      </Stack>
    )
  }

  const nuevo = puedeCrear
    ? <Button variant="contained" component={RouterLink} to="/ventas/comprobantes/nuevo?tipo=presupuesto">Nuevo presupuesto</Button>
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
        titulo="Presupuestos"
        descripcion="Cotizaciones a clientes. Se pueden copiar y modificar."
        accion={<>{exportarBoton}{nuevo}</>}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {tiendas.length > 0 ? (
            <FiltroEmpresa
              empresas={tiendas}
              valor={empresaId === '' ? null : empresaId}
              onCambiar={(id) => { onEmpresa(id ?? ''); setPagina(1) }}
              textoAyuda={TEXTO_AYUDA_TIENDA}
            />
          ) : null}

          {exito ? <Alert severity="success" role="status" onClose={() => setExito(null)}>{exito}</Alert> : null}
          {errorAccion ? <Alert severity="error" role="alert" onClose={() => setErrorAccion(null)}>{errorAccion}</Alert> : null}
          {aviso ? (
            <Alert
              severity={aviso.severidad}
              role="status"
              onClose={cerrarAviso}
              action={aviso.enlace ? <Button color="inherit" size="small" component={RouterLink} to={aviso.enlace.to}>{aviso.enlace.texto}</Button> : undefined}
            >
              {aviso.texto}
            </Alert>
          ) : null}

          <BarraHerramientas contador={primeraCarga || hayError ? undefined : `${total} ${total === 1 ? 'presupuesto' : 'presupuestos'}`}>
            <TextField
              type="search"
              label="Buscar por cliente o número"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ width: 320, maxWidth: '100%' }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado}
              onChange={(_, nuevoEstado: FiltroEstadoPresupuesto | null) => {
                if (nuevoEstado === null) return
                setEstado(nuevoEstado)
                setPagina(1)
              }}
              sx={{ flexWrap: 'wrap' }}
            >
              {FILTROS_ESTADO.map((f) => <ToggleButton key={f.valor} value={f.valor}>{f.etiqueta}</ToggleButton>)}
            </ToggleButtonGroup>
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {primeraCarga || hayError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {cargando && !primeraCarga ? <LinearProgress aria-label="Actualizando presupuestos" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={cargando}>
            {primeraCarga ? (
              <EstadoCargaPagina />
            ) : hayError ? (
              <EstadoError descripcion="No pudimos cargar los presupuestos." reintentar={() => void cargar()} />
            ) : presupuestos.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="Sin resultados" descripcion="Probá con otra búsqueda o cambiá el filtro." />
              ) : (
                <EstadoVacio titulo="Todavía no hay presupuestos." descripcion={puedeCrear ? 'Creá el primero con «Nuevo presupuesto».' : undefined} accion={nuevo} />
              )
            ) : (
              <>
                <ContenidoAdaptable items={presupuestos} columnas={columnas} obtenerClave={(p) => p.id} acciones={acciones} etiquetaTabla="Presupuestos" />
                <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Presupuestos por página"
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
