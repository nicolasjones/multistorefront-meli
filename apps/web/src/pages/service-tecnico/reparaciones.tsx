import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, LinearProgress, Link, Stack, TablePagination, Typography } from '@mui/material'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useExportarCsv } from '../../hooks/useExportarCsv'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ExportarCsvBoton } from '../../components/stock/ExportarCsvBoton'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { FiltrosReparaciones } from '../../components/service/FiltrosReparaciones'
import { ETIQUETA_PENDIENTE_STOCK, MarcaStockItem } from '../../components/service/MarcaStockItem'
import { PestanasService } from '../../components/service/PestanasService'
import { nombreArchivoCsv } from '../../lib/exportarCsv'
import {
  COLUMNAS as COLUMNAS_EXPORTACION,
  pedirLoteReparaciones,
  TAMANO_LOTE_REPARACIONES,
  type FiltrosExportacionReparaciones,
} from '../../lib/exportarReparaciones'
import { listarTecnicos, type Tecnico } from '../../lib/reparaciones'
import {
  formatearDiaCompleto,
  formatearDiaMes,
  PERIODO_INICIAL,
  subtituloPeriodo,
  TAMANO_PAGINA_REPARACIONES,
  useListarReparaciones,
  type PeriodoReparaciones,
  type ReparacionListada,
} from '../../lib/reparacionesListado'
import { formatearARS } from '../../lib/serviceTecnico'

// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

type TonoEtiqueta = Parameters<typeof EtiquetaEstado>[0]['variante']

const nombreArchivoReparaciones = () => nombreArchivoCsv('reparaciones')

const columnas: ColumnaAdaptable<ReparacionListada>[] = [
  {
    clave: 'reparacion', encabezado: 'Reparación',
    render: (reparacion) => (
      <Stack>
        <Link component={RouterLink} to={`/service-tecnico/reparaciones/${reparacion.id}`} underline="hover" sx={{ fontWeight: 600 }}>
          {reparacion.codigo}
        </Link>
        <Typography variant="xs">Ingreso {formatearDiaMes(reparacion.ingreso_en)}</Typography>
      </Stack>
    ),
  },
  { clave: 'tienda', encabezado: 'Tienda', render: (reparacion) => reparacion.empresa },
  { clave: 'cliente', encabezado: 'Cliente', render: (reparacion) => reparacion.cliente },
  {
    clave: 'equipo', encabezado: 'Equipo',
    render: (reparacion) => (
      <Stack>
        <span>{reparacion.equipo}</span>
        <Typography variant="xs">{reparacion.modelo}</Typography>
      </Stack>
    ),
  },
  { clave: 'serie', encabezado: 'N.º de serie', render: (reparacion) => reparacion.numero_serie ?? '—' },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (reparacion) => (
      <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
        <EtiquetaEstado texto={reparacion.estado} variante={reparacion.estado_tono as TonoEtiqueta} />
        {reparacion.pendientes_stock > 0 ? <MarcaStockItem etiqueta={ETIQUETA_PENDIENTE_STOCK} /> : null}
      </Stack>
    ),
  },
  { clave: 'tecnico', encabezado: 'Técnico', render: (reparacion) => reparacion.tecnico ?? '—' },
  {
    clave: 'entrega', encabezado: 'Entrega',
    render: (reparacion) => (reparacion.entrega_prevista ? formatearDiaCompleto(reparacion.entrega_prevista) : '—'),
  },
  {
    clave: 'total', encabezado: 'Total', align: 'right',
    render: (reparacion) => (reparacion.total_cliente > 0 ? formatearARS(reparacion.total_cliente) : 'A presupuestar'),
  },
]

// Service técnico · Reparaciones (F-SVC-04, FR-001…FR-010). Listado paginado en el servidor con filtros por
// período (fecha de entrega prevista), N.º de serie y técnico. La tienda es la empresa activa de la barra
// superior (Principio VIII): al cambiarla se vuelve a la primera página y se descartan las filas anteriores.
export function ServicioReparaciones() {
  const { nivel } = useNivelSeccion('service_tecnico')
  const puedeEditar = nivel === 'edicion'
  const puedeExportar = usePuedeAccion('service_tecnico', 'exportar').puede === true
  const { empresaActivaId, isLoading: cargandoEmpresas } = useEmpresasAccesibles()
  const [periodo, setPeriodo] = useState<PeriodoReparaciones>(PERIODO_INICIAL)
  const [serie, setSerie] = useState('')
  const [tecnicoId, setTecnicoId] = useState('')
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [errorTecnicos, setErrorTecnicos] = useState(false)
  // La página pertenece a la combinación de filtros con la que se eligió: si esa combinación cambia
  // (período, serie, técnico o empresa activa), vale la primera sin efectos de por medio.
  const clave = `${empresaActivaId ?? ''}|${periodo}|${serie.trim()}|${tecnicoId}`
  const [elegida, setElegida] = useState({ clave, pagina: 1 })
  const pagina = elegida.clave === clave ? elegida.pagina : 1

  useEffect(() => {
    let vigente = true
    listarTecnicos()
      .then((lista) => { if (vigente) setTecnicos(lista) })
      .catch((error: unknown) => {
        console.error('No pudimos cargar los técnicos del filtro.', error)
        if (vigente) setErrorTecnicos(true)
      })
    return () => { vigente = false }
  }, [])

  const { filas, total, isLoading: cargandoListado, isFetching, isError, mensajeError, refetch } = useListarReparaciones({
    empresaId: empresaActivaId, periodo, serie, tecnicoId, pagina, tamano: TAMANO_PAGINA_REPARACIONES,
  })

  // Mientras se resuelve (o se relee) la empresa activa no se muestra nada: ni filas de otra empresa ni de «todas».
  const isLoading = cargandoEmpresas || cargandoListado

  // Página fuera de rango (p. ej. bajó la cantidad): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && filas.length === 0 && pagina > 1) setElegida({ clave, pagina: 1 })
  }, [isLoading, isFetching, isError, filas.length, pagina, clave])

  // «Exportar» baja todas las filas del filtro vigente (no solo la página). Los filtros y la empresa activa se
  // congelan al pulsar: si cambian mientras corre, el archivo sigue siendo el de la consulta que se pidió (FR-060).
  const filtrosCongelados = useRef<FiltrosExportacionReparaciones | null>(null)
  const congelarFiltros = useCallback(() => {
    filtrosCongelados.current = { empresaId: empresaActivaId, periodo, serie, tecnicoId }
  }, [empresaActivaId, periodo, serie, tecnicoId])
  const pedirLoteExportacion = useCallback(
    (desde: number, limite: number) => pedirLoteReparaciones(filtrosCongelados.current!, desde, limite),
    [],
  )
  const exportacion = useExportarCsv({
    columnas: COLUMNAS_EXPORTACION,
    nombreArchivo: nombreArchivoReparaciones,
    tamanoLote: TAMANO_LOTE_REPARACIONES,
    pedirLote: pedirLoteExportacion,
    iniciar: congelarFiltros,
  })

  const alCambiarSerie = useCallback((nueva: string) => setSerie(nueva), [])
  const buscandoPorSerie = serie.trim() !== ''
  const contador = `${total} ${total === 1 ? 'reparación' : 'reparaciones'}`

  return (
    <Box>
      <EncabezadoPagina
        titulo="Reparaciones"
        descripcion="Equipos que ingresan al taller, con su cliente, técnico y fechas."
        accion={
          puedeEditar ? (
            <Button variant="contained" component={RouterLink} to="/service-tecnico/reparaciones/nueva">
              Nueva reparación
            </Button>
          ) : undefined
        }
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasService activa="reparaciones" />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <BarraHerramientas
            contador={isLoading || isError ? undefined : contador}
            ayuda={buscandoPorSerie ? 'La búsqueda por N.º de serie no depende del período.' : subtituloPeriodo()}
          >
            <FiltrosReparaciones
              periodo={periodo}
              onPeriodo={setPeriodo}
              serie={serie}
              onSerie={alCambiarSerie}
              tecnicoId={tecnicoId}
              onTecnico={setTecnicoId}
              tecnicos={tecnicos}
              errorTecnicos={errorTecnicos}
            />
            {puedeExportar ? <ExportarCsvBoton {...exportacion} /> : null}
          </BarraHerramientas>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
          </Box>
          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando reparaciones" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion={mensajeError ?? undefined} reintentar={() => void refetch()} />
            ) : filas.length === 0 ? (
              <EstadoVacio
                titulo={buscandoPorSerie ? 'No hay reparaciones con ese número de serie' : 'No hay reparaciones en este período'}
                descripcion={buscandoPorSerie ? 'Revisá el número o probá con una parte.' : 'Probá con otro período, otro técnico u otra tienda.'}
              />
            ) : (
              <>
                <ContenidoAdaptable
                  items={filas}
                  columnas={columnas}
                  obtenerClave={(reparacion) => reparacion.id}
                  etiquetaTabla="Reparaciones"
                />
                <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA_REPARACIONES}
                  rowsPerPageOptions={[TAMANO_PAGINA_REPARACIONES]}
                  onPageChange={(_, nueva) => setElegida({ clave, pagina: nueva + 1 })}
                  labelRowsPerPage="Reparaciones por página"
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
