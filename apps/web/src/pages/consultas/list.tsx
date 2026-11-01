import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  Alert, Box, Button, Chip, Dialog, DialogContent, LinearProgress, Link, Snackbar, Stack, TablePagination, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useBandejaConsultas, useConsulta, useConsultasNuevas } from '../../hooks/useConsultas'
import {
  COLOR_ESTADO_CONSULTA,
  ESTADOS_CONSULTA,
  ETIQUETA_ESTADO_CONSULTA,
  ETIQUETA_ORIGEN_CONSULTA,
  TAMANO_PAGINA_CONSULTAS,
  formatearCuando,
  nombreProducto,
  type Consulta,
  type EstadoConsulta,
} from '../../lib/consultas'
import { RespuestasRapidasDialog } from './RespuestasRapidasDialog'
import { DetalleConsulta } from '../../components/consultas/DetalleConsulta'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const ESPERA_BUSQUEDA_MS = 300
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const textoConteo = (total: number) => `${total} ${total === 1 ? 'consulta' : 'consultas'}`

// Bandeja de consultas (F-CON-01, `Consultas.dc.html`). Quien tiene `consultas` en lectura la ve;
// con edición, además, cambia estado, responsable y nota desde el detalle. La búsqueda, los
// filtros y la paginación se resuelven en el servidor (vista `consultas_bandeja`, RLS del
// llamador). La empresa activa de la barra superior es la fuente de verdad del filtro «Tienda»
// (Principio VIII, FR-008): al cambiarla se recarga todo, se reencuadra la paginación y se cierra
// el detalle abierto.
export function ConsultaList() {
  const { nivel } = useNivelSeccion('consultas')
  const puedeEditar = nivel === 'edicion'
  const [params, setParams] = useSearchParams()
  const parametro = params.get('consulta')
  const consultaId = parametro !== null && UUID.test(parametro) ? parametro : null

  const {
    empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const listo = !cargandoTiendas

  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [estado, setEstado] = useState<EstadoConsulta | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(1)
  const [exito, setExito] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [respuestasAbierto, setRespuestasAbierto] = useState(false)

  const cerrarDetalle = () => {
    setParams((actual) => {
      const copia = new URLSearchParams(actual)
      copia.delete('consulta')
      return copia
    }, { replace: true })
  }
  const abrirDetalle = (id: string) => {
    setParams((actual) => {
      const copia = new URLSearchParams(actual)
      copia.set('consulta', id)
      return copia
    })
  }

  useEffect(() => {
    const espera = setTimeout(() => {
      // Solo reinicia la página si el texto cambió: al montar no se pisa la página elegida.
      if (texto !== textoAplicado) {
        setTextoAplicado(texto)
        setPagina(1)
      }
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  // Cambió la empresa (barra superior): paginación a la primera y detalle cerrado. La primera
  // empresa resuelta no cuenta como cambio, así un enlace `?consulta=<id>` no se cierra al cargar.
  const ultimaEmpresa = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!listo) return
    if (ultimaEmpresa.current === undefined) {
      ultimaEmpresa.current = empresaId
      return
    }
    if (ultimaEmpresa.current !== empresaId) {
      ultimaEmpresa.current = empresaId
      setPagina(1)
      // Principio VIII: un diálogo abierto no guarda datos de la empresa anterior bajo la nueva.
      if (respuestasAbierto) {
        setRespuestasAbierto(false)
        setAviso('Cambió la empresa activa: se cerró «Respuestas rápidas». Volvé a abrirlo para la nueva empresa.')
      }
      setParams((actual) => {
        if (!actual.has('consulta')) return actual
        const copia = new URLSearchParams(actual)
        copia.delete('consulta')
        return copia
      }, { replace: true })
    }
  }, [listo, empresaId, setParams, respuestasAbierto])

  const { consultas, total, isLoading, isFetching, isError, refetch } = useBandejaConsultas(
    { empresaId, estado, texto: textoAplicado, desde, hasta, pagina, tamano: TAMANO_PAGINA_CONSULTAS },
    { habilitado: listo },
  )
  const { total: nuevas } = useConsultasNuevas(empresaId, { habilitado: listo })
  const detalle = useConsulta(consultaId)

  // Si la página quedó fuera de rango, el servidor no devuelve filas: se vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && consultas.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, consultas.length, pagina])

  const hayFiltros = textoAplicado.trim() !== '' || estado !== null || desde !== '' || hasta !== '' || empresaId !== null

  const columnas: ColumnaAdaptable<Consulta>[] = [
    {
      clave: 'estado', encabezado: 'Estado',
      render: (consulta) => <Chip size="small" color={COLOR_ESTADO_CONSULTA[consulta.estado]} label={ETIQUETA_ESTADO_CONSULTA[consulta.estado]} />,
    },
    { clave: 'cuando', encabezado: 'Cuándo', render: (consulta) => <Typography component="span" sx={{ whiteSpace: 'nowrap' }}>{formatearCuando(consulta.created_at)}</Typography> },
    { clave: 'empresa', encabezado: 'Empresa', render: (consulta) => <Chip size="small" variant="outlined" label={consulta.empresa_nombre} /> },
    {
      clave: 'contacto', encabezado: 'Contacto',
      render: (consulta) => (
        <Stack spacing={0} sx={{ alignItems: 'flex-start' }}>
          <Link
            component="button"
            type="button"
            underline="hover"
            onClick={() => abrirDetalle(consulta.id)}
            aria-label={`Abrir la consulta de ${consulta.nombre}`}
            sx={{ fontWeight: 600, textAlign: 'left' }}
          >
            {consulta.nombre}
          </Link>
          <Typography component="span" variant="xs">{consulta.contacto}</Typography>
        </Stack>
      ),
    },
    { clave: 'producto', encabezado: 'Producto', render: (consulta) => nombreProducto(consulta) },
    { clave: 'origen', encabezado: 'Origen', render: (consulta) => <Chip size="small" variant="outlined" label={ETIQUETA_ORIGEN_CONSULTA[consulta.origen]} /> },
  ]

  const sinAcceso = consultaId !== null && !detalle.isLoading && (detalle.noEncontrada || detalle.isError)

  return (
    <Box>
      <EncabezadoPagina
        titulo="Consultas"
        descripcion="Mensajes del formulario de contacto de las tiendas e interés por WhatsApp desde las fichas de producto."
        contexto={<ContextoOrganizacionActiva />}
        accion={<Button variant="outlined" onClick={() => setRespuestasAbierto(true)}>Respuestas rápidas</Button>}
      />
      <Alert severity="info" sx={{ mb: 2 }}>
        Cada consulta nueva envía un aviso por correo a la dirección de avisos de la empresa. La respuesta se da por correo o WhatsApp, fuera del sistema; acá se registra si ya fue atendida.
      </Alert>
      {sinAcceso ? (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" onClick={cerrarDetalle}>Entendido</Button>}>
          {detalle.isError ? 'No pudimos cargar esa consulta. Intentá de nuevo.' : 'No encontramos esa consulta o no tenés acceso a ella.'}
        </Alert>
      ) : null}
      <ContenedorSeccion>
        {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <FiltroEmpresa
              empresas={empresas}
              valor={empresaId}
              onCambiar={(id) => {
                elegirEmpresa(id)
                setPagina(1)
              }}
              cargando={cargandoTiendas}
              hayError={errorTiendas}
              textoAyuda="Cada consulta llega por el formulario o el WhatsApp de una tienda. Si elegís una empresa en la barra superior, se filtra por esa tienda."
            />
          </Box>
        ) : null}

        <Stack spacing={2}>
          <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
            <TextField
              type="search"
              label="Buscar consultas"
              placeholder="Buscar por nombre, producto o mensaje"
              value={texto}
              onChange={(evento) => setTexto(evento.target.value)}
              size="small"
              sx={{ width: 320, maxWidth: '100%' }}
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado ?? 'todas'}
              onChange={(_, valor: string | null) => {
                if (valor === null) return
                setEstado(valor === 'todas' ? null : (valor as EstadoConsulta))
                setPagina(1)
              }}
            >
              <ToggleButton value="todas">Todas</ToggleButton>
              {ESTADOS_CONSULTA.map((valor) => (
                <ToggleButton key={valor} value={valor}>
                  {valor === 'nueva'
                    ? `Nuevas${nuevas === null ? '' : ` (${nuevas})`}`
                    : valor === 'en_curso' ? ETIQUETA_ESTADO_CONSULTA.en_curso : 'Resuelta'}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <TextField
              type="date"
              label="Desde"
              size="small"
              value={desde}
              onChange={(evento) => {
                setDesde(evento.target.value)
                setPagina(1)
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: hasta || undefined } }}
            />
            <TextField
              type="date"
              label="Hasta"
              size="small"
              value={hasta}
              onChange={(evento) => {
                setHasta(evento.target.value)
                setPagina(1)
              }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: desde || undefined } }}
            />
          </Stack>

          <Box role="status" aria-live="polite" sx={visuallyHidden}>
            {isLoading || isError ? '' : textoConteo(total)}
          </Box>
          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando consultas" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar las consultas." reintentar={() => void refetch()} />
            ) : consultas.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="Sin resultados para el filtro." descripcion="Probá con otro texto o quitá algún filtro." />
              ) : (
                <EstadoVacio titulo="Todavía no hay consultas." descripcion="Cuando un visitante escriba desde una tienda, la consulta aparece acá." />
              )
            ) : (
              <>
                <ContenidoAdaptable
                  items={consultas}
                  columnas={columnas}
                  obtenerClave={(consulta) => consulta.id}
                  etiquetaTabla="Consultas"
                />
                <Stack direction="row" justifyContent="flex-end" alignItems="center" useFlexGap flexWrap="wrap">
                  <Typography component="span" variant="s">{textoConteo(total)}</Typography>
                  {consultas.length > 0 ? (
                    <TablePagination
                      component="div"
                      count={total}
                      page={pagina - 1}
                      rowsPerPage={TAMANO_PAGINA_CONSULTAS}
                      rowsPerPageOptions={[TAMANO_PAGINA_CONSULTAS]}
                      onPageChange={(_, nueva) => setPagina(nueva + 1)}
                      labelRowsPerPage="Consultas por página"
                      labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                    />
                  ) : null}
                </Stack>
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      {consultaId !== null && detalle.isLoading ? (
        <Dialog open onClose={cerrarDetalle} fullWidth maxWidth="sm" aria-label="Cargando la consulta">
          <DialogContent><EstadoCargaPagina /></DialogContent>
        </Dialog>
      ) : null}
      {consultaId !== null && detalle.consulta ? (
        <DetalleConsulta
          consulta={detalle.consulta}
          puedeEditar={puedeEditar}
          onCerrar={cerrarDetalle}
          onGuardado={(mensaje) => {
            cerrarDetalle()
            setExito(mensaje)
          }}
          onRecargar={() => void detalle.refetch()}
        />
      ) : null}

      {respuestasAbierto ? (
        <RespuestasRapidasDialog
          key={empresaId ?? 'todas'}
          empresaId={empresaId}
          empresaNombre={empresas.find((e) => e.id === empresaId)?.nombre ?? null}
          puedeEditar={puedeEditar}
          onCerrar={() => setRespuestasAbierto(false)}
        />
      ) : null}

      <Snackbar open={aviso !== null} autoHideDuration={6000} onClose={() => setAviso(null)}>
        <Alert severity="info" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
      <Snackbar open={exito !== null} autoHideDuration={4000} onClose={() => setExito(null)}>
        <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>
      </Snackbar>
    </Box>
  )
}
