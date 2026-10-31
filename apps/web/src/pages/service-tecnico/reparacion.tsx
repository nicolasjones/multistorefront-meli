import { type FormEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  Link,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeAccion } from '../../hooks/usePuedeAccion'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { mensajeRepuestoAgregado } from '../../lib/reparacionItems'
import { formatearARS, listarEstados, listarModelos, type EstadoReparacion, type ModeloEquipo } from '../../lib/serviceTecnico'
import {
  LARGO_MAXIMO_REPARACION,
  MENSAJE_ANULADA,
  aFormulario,
  actualizarReparacion,
  cambiarEstadoReparacion,
  crearReparacion,
  errorDeCampo,
  esConflictoDeEdicion,
  formularioVacio,
  hoyEnArgentina,
  listarHistorial,
  listarTecnicos,
  mensajeDeErrorReparacion,
  obtenerReparacion,
  validarReparacion,
  type CampoReparacion,
  type ClienteElegido,
  type ErroresReparacion,
  type EventoHistorial,
  type FormularioReparacion,
  type Reparacion,
  type Tecnico,
} from '../../lib/reparaciones'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { ClienteSelector } from '../../components/service/ClienteSelector'
import { AltaRapidaClienteDialog } from '../../components/service/AltaRapidaClienteDialog'
import { AnularDialog } from '../../components/service/AnularDialog'
import { EntregaDialog } from '../../components/service/EntregaDialog'
import { HistorialEstados } from '../../components/service/HistorialEstados'
import { ItemsReparacion } from '../../components/service/ItemsReparacion'
import { ComprobanteReparacion } from '../../components/service/ComprobanteReparacion'
import { useComprobanteReparacion } from '../../hooks/useComprobanteReparacion'
import { useAvisosReparacion } from '../../hooks/useAvisosReparacion'
import { AvisosReparacion } from '../../components/service/AvisosReparacion'
import { MENSAJE_CLIENTE_SIN_CORREO } from '../../lib/reparacionAvisos'

// Los diálogos de ítems se bajan recién al abrirlos: no pesan en la carga inicial del detalle.
const AgregarManoObraDialog = lazy(() =>
  import('../../components/service/AgregarManoObraDialog').then((modulo) => ({ default: modulo.AgregarManoObraDialog })),
)
const AgregarRepuestoDialog = lazy(() =>
  import('../../components/service/AgregarRepuestoDialog').then((modulo) => ({ default: modulo.AgregarRepuestoDialog })),
)

// «Avisar al cliente» arranca destildada: no se manda un correo sin querer (spec, Decisiones abiertas 4).
const AVISAR_AL_CAMBIAR_ESTADO_POR_DEFECTO = false

type TonoEtiqueta = Parameters<typeof EtiquetaEstado>[0]['variante']

// Service técnico · Reparación (F-SVC-02, FR-016): alta en `/reparaciones/nueva` y edición en `/reparaciones/:id`.
// La autoridad de acceso y de costos es la base (RLS y RPC); acá el nivel y `ver_costos` solo deciden qué se ofrece.
// La sección «Mano de obra y repuestos» (F-SVC-06, FR-027 y FR-028) agrega y quita ítems por RPC propia, no por
// «Guardar». «Avisar al cliente» y los avisos al cliente son de F-SVC-14 (FR-023 a FR-028). «Imprimir orden» e «Imprimir remito» abren las vistas A4 (F-SVC-07).
// Estado, Historial, Entrega y Anulación son de F-SVC-03 (FR-030 a FR-034): el estado cambia por RPC propia.
export function ServicioReparacion() {
  const { id } = useParams()
  const esNueva = id === undefined
  const navigate = useNavigate()
  const ubicacion = useLocation()
  const { nivel } = useNivelSeccion('service_tecnico')
  const { nivel: nivelClientes } = useNivelSeccion('clientes')
  const { nivel: nivelVentas } = useNivelSeccion('ventas')
  const { puede: puedeVerCostosEnPanel } = usePuedeAccion('service_tecnico', 'ver_costos')
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresasAccesibles()

  const [reparacion, setReparacion] = useState<Reparacion | null>(null)
  const [modelos, setModelos] = useState<ModeloEquipo[]>([])
  const [tecnicos, setTecnicos] = useState<Tecnico[]>([])
  const [cargado, setCargado] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<FormularioReparacion>(() => formularioVacio(''))
  const [errores, setErrores] = useState<ErroresReparacion>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState<string | null>(
    (ubicacion.state as { mensaje?: string } | null)?.mensaje ?? null,
  )
  const [altaRapidaAbierta, setAltaRapidaAbierta] = useState(false)
  const [estados, setEstados] = useState<EstadoReparacion[]>([])
  const [historial, setHistorial] = useState<EventoHistorial[]>([])
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null)
  const [cambiandoEstado, setCambiandoEstado] = useState(false)
  const [avisarAlCambiar, setAvisarAlCambiar] = useState(AVISAR_AL_CAMBIAR_ESTADO_POR_DEFECTO)
  const [estadoAEntregar, setEstadoAEntregar] = useState<EstadoReparacion | null>(null)
  const [anularAbierto, setAnularAbierto] = useState(false)
  const [itemAbierto, setItemAbierto] = useState<'mano_obra' | 'repuesto' | null>(null)
  const ultimaPeticion = useRef(0)
  // Estado vigente para `aplicarOperacion`: la RPC está en vuelo y la clausura del render ya quedó vieja.
  const reparacionVigente = useRef<Reparacion | null>(null)
  const formularioVigente = useRef(formulario)
  useEffect(() => {
    reparacionVigente.current = reparacion
    formularioVigente.current = formulario
  }, [reparacion, formulario])

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setErrorCarga(null)
    try {
      const [listaModelos, listaTecnicos, existente] = await Promise.all([
        listarModelos(),
        listarTecnicos(),
        id ? obtenerReparacion(id) : Promise.resolve(null),
      ])
      if (peticion !== ultimaPeticion.current) return
      setModelos(listaModelos)
      setTecnicos(listaTecnicos)
      setReparacion(existente)
      if (existente) setFormulario(aFormulario(existente))
      setCargado(true)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      setErrorCarga(
        (error as { code?: string } | null)?.code === 'P0002'
          ? 'Esa reparación no existe o no pertenece a tu organización.'
          : mensajeDeErrorReparacion(error, 'No pudimos cargar la reparación.'),
      )
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const refrescarHistorial = useCallback(async (reparacionId: string) => {
    try {
      setHistorial(await listarHistorial(reparacionId))
      setErrorHistorial(null)
    } catch (error) {
      setErrorHistorial(mensajeDeErrorReparacion(error, 'No pudimos cargar el historial de estados.'))
    }
  }, [])

  // Estados (selector) e historial: se cargan aparte para que un fallo no tire abajo la edición de la reparación.
  const reparacionId = reparacion?.id
  useEffect(() => {
    if (!reparacionId) return
    let vigente = true
    listarEstados()
      .then((lista) => {
        if (vigente) setEstados(lista)
      })
      .catch((error) => {
        if (vigente) setErrorEstado(mensajeDeErrorReparacion(error, 'No pudimos cargar los estados.'))
      })
    void refrescarHistorial(reparacionId)
    return () => {
      vigente = false
    }
  }, [reparacionId, refrescarHistorial])

  // Tienda por defecto = empresa activa (FR-016), mientras la persona no haya elegido otra.
  useEffect(() => {
    if (esNueva && empresaActivaId) {
      setFormulario((previo) => (previo.empresa_id === '' ? { ...previo, empresa_id: empresaActivaId } : previo))
    }
  }, [esNueva, empresaActivaId])

  const anulada = reparacion?.anulada_en != null
  const puedeEditar = nivel === 'edicion' && !anulada
  const conCostos = esNueva ? puedeVerCostosEnPanel === true : reparacion?.puede_ver_costos === true
  const puedeAltaRapida = nivelClientes === 'edicion' && puedeEditar
  // Cerrada = estado que cierra o entrega registrada: ya no admite cambios de estado (FR-031).
  const cerrada = reparacion !== null && (reparacion.estado_cierra || reparacion.entrega_real !== null)
  const puedeCambiarEstado = puedeEditar && !cerrada && !cambiandoEstado
  // Ítems: solo con edición y la reparación abierta (ni entregada ni anulada, FR-024).
  const puedeEditarItems = puedeEditar && !cerrada
  // Cobro (F-SVC-13): comprobante de Ventas de la reparación. La base valida Service y Ventas en la tienda.
  const cobro = useComprobanteReparacion(reparacion?.id, empresaActivaId, reparacion !== null)
  const puedeGenerarComprobante =
    reparacion !== null &&
    nivel === 'edicion' &&
    nivelVentas === 'edicion' &&
    !anulada &&
    (reparacion.items?.length ?? 0) > 0 &&
    cobro.comprobante === null &&
    cobro.consultado &&
    !cobro.cargando &&
    cobro.errorCarga === null
  // Avisos al cliente (F-SVC-14): historial y pedido de aviso. La base valida permiso, tienda y correo.
  const avisosCliente = useAvisosReparacion(reparacion?.id, reparacion?.cliente_id, empresaActivaId, reparacion !== null)
  const clienteSinCorreo = avisosCliente.clienteConCorreo === false
  const puedeAvisar = reparacion !== null && puedeEditar && !cerrada && !clienteSinCorreo
  const avisoEnviado = avisosCliente.aviso
  useEffect(() => {
    if (avisoEnviado) setExito(avisoEnviado)
  }, [avisoEnviado])
  const avisoCobro = cobro.aviso
  useEffect(() => {
    if (avisoCobro) setExito(avisoCobro)
  }, [avisoCobro])
  const estadoActual = estados.find((estado) => estado.id === reparacion?.estado_id)
  const estadosElegibles = estados.filter((estado) => estado.activo || estado.id === reparacion?.estado_id)

  const equipos = useMemo(() => {
    const visibles = modelos.filter((modelo) => modelo.activo || modelo.id === formulario.modelo_id)
    return [...new Set(visibles.map((modelo) => modelo.equipo))].sort((a, b) => a.localeCompare(b, 'es'))
  }, [modelos, formulario.modelo_id])
  const modelosDelEquipo = useMemo(
    () => modelos.filter((modelo) => modelo.equipo === formulario.equipo && (modelo.activo || modelo.id === formulario.modelo_id)),
    [modelos, formulario.equipo, formulario.modelo_id],
  )

  const cambiar = <C extends keyof FormularioReparacion>(campo: C, valor: FormularioReparacion[C]) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined, ...(campo === 'cliente' ? { cliente_id: undefined } : {}) }))
  }

  const elegirCliente = (cliente: ClienteElegido | null) => {
    setFormulario((previo) => ({ ...previo, cliente, contacto: cliente ? cliente.contacto : previo.contacto }))
    setErrores((previos) => ({ ...previos, cliente_id: undefined }))
  }

  // Una operación de estado devuelve la reparación completa. Se concilia con lo que la persona tiene en pantalla
  // para no tapar el bloqueo optimista de «Guardar» (`updated_at`):
  // - solo cambió el estado → se toma el `updated_at` nuevo (es el de esta misma operación);
  // - cambió algo más (otra persona editó) y el formulario está intacto → se recarga el formulario;
  // - cambió algo más y hay ediciones sin guardar → se conserva el `updated_at` viejo, así «Guardar» detecta el conflicto.
  const aplicarOperacion = (actualizada: Reparacion, mensaje: string) => {
    const previa = reparacionVigente.current
    if (!previa) return
    const datosPrevios = JSON.stringify(aFormulario(previa))
    const otraPersonaEdito = JSON.stringify(aFormulario(actualizada)) !== datosPrevios
    const hayEdicionesSinGuardar = JSON.stringify(formularioVigente.current) !== datosPrevios
    if (!otraPersonaEdito) {
      setReparacion(actualizada)
      setExito(mensaje)
    } else if (!hayEdicionesSinGuardar) {
      setReparacion(actualizada)
      setFormulario(aFormulario(actualizada))
      setExito(`${mensaje}. Otra persona modificó los datos y los actualizamos.`)
    } else {
      setReparacion({ ...actualizada, updated_at: previa.updated_at })
      setExito(`${mensaje}. Otra persona modificó los datos: al guardar te vamos a avisar del conflicto.`)
    }
    void refrescarHistorial(actualizada.id)
  }

  const elegirEstado = async (estadoId: string) => {
    if (!reparacion || estadoId === reparacion.estado_id) return
    const elegido = estados.find((estado) => estado.id === estadoId)
    if (!elegido) return
    setErrorEstado(null)
    if (elegido.cierra) {
      setEstadoAEntregar(elegido)
      return
    }
    setCambiandoEstado(true)
    try {
      aplicarOperacion(await cambiarEstadoReparacion(reparacion.id, estadoId), `Estado cambiado a «${elegido.nombre}»`)
    } catch (error) {
      setErrorEstado(mensajeDeErrorReparacion(error, 'No pudimos cambiar el estado.'))
      setCambiandoEstado(false)
      return
    }
    // El aviso va DESPUÉS del cambio y nunca lo revierte (FR-025): si falla, el estado queda y se informa el error.
    if (avisarAlCambiar && puedeAvisar) await avisosCliente.avisar()
    setCambiandoEstado(false)
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando || !puedeEditar) return
    const encontrados = validarReparacion(formulario, { esNueva, conCostos })
    setErrores(encontrados)
    setErrorGeneral(null)
    setConflicto(false)
    if (Object.keys(encontrados).length > 0) {
      setErrorGeneral('Revisá los campos marcados antes de guardar.')
      // Foco al primer campo con error, cuando React ya pintó `aria-invalid`.
      const formularioDom = evento.currentTarget as HTMLFormElement
      requestAnimationFrame(() => formularioDom.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setGuardando(true)
    try {
      if (esNueva) {
        const creada = await crearReparacion(formulario, conCostos)
        navigate(`/service-tecnico/reparaciones/${creada.id}`, { replace: true, state: { mensaje: `Reparación ${creada.codigo} creada` } })
      } else if (reparacion) {
        const guardada = await actualizarReparacion(reparacion, formulario, conCostos)
        setReparacion(guardada)
        setFormulario(aFormulario(guardada))
        setExito('Reparación guardada')
      }
    } catch (error) {
      const deCampo = errorDeCampo(error)
      if (deCampo) {
        console.error('La base rechazó un dato de la reparación.', error)
        setErrores({ [deCampo.campo]: deCampo.mensaje } as Partial<Record<CampoReparacion, string>>)
      } else if (esConflictoDeEdicion(error)) {
        setConflicto(true)
        setErrorGeneral(mensajeDeErrorReparacion(error, 'No pudimos guardar la reparación.'))
      } else {
        setErrorGeneral(mensajeDeErrorReparacion(error, esNueva ? 'No pudimos crear la reparación.' : 'No pudimos guardar la reparación.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  const titulo = reparacion ? `Reparación ${reparacion.codigo}` : 'Nueva reparación'
  const subtitulo = reparacion ? `${reparacion.cliente} · ${reparacion.equipo} ${reparacion.modelo}` : undefined
  const bloqueado = !puedeEditar || guardando

  const enlaceListado = (
    <Link component={RouterLink} to="/service-tecnico/reparaciones" underline="hover" sx={{ display: 'inline-block', mb: 1.5 }}>
      ← Reparaciones
    </Link>
  )

  if (errorCarga) {
    return (
      <Box>
        {enlaceListado}
        <EstadoError descripcion={errorCarga} reintentar={() => void cargar()} />
      </Box>
    )
  }
  if (!cargado || cargandoEmpresas) return <EstadoCargaPagina />

  // El diálogo de alta rápida va FUERA del <form>: su submit burbujea por el árbol de React (portal) y, dentro,
  // dispararía también el guardado de la reparación.
  return (
    <Box>
      <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate aria-label={titulo}>
      {enlaceListado}
      <EncabezadoPagina
        titulo={titulo}
        descripcion={subtitulo}
        accion={
          <>
            {reparacion ? <EtiquetaEstado texto={reparacion.estado} variante={reparacion.estado_tono as TonoEtiqueta} /> : null}
            {puedeAvisar ? (
              <Button
                variant="outlined"
                startIcon={<MailOutlineIcon />}
                onClick={() => void avisosCliente.avisar()}
                disabled={avisosCliente.avisando || guardando}
              >
                Avisar al cliente
              </Button>
            ) : null}
            {reparacion ? (
              <Button component={RouterLink} to={`/service-tecnico/reparaciones/${reparacion.id}/orden`} variant="outlined">
                Imprimir orden
              </Button>
            ) : null}
            {reparacion && reparacion.entrega_real !== null && reparacion.anulada_en === null ? (
              <Button component={RouterLink} to={`/service-tecnico/reparaciones/${reparacion.id}/remito`} variant="outlined">
                Imprimir remito
              </Button>
            ) : null}
            {puedeEditar && reparacion ? (
              <Button color="error" variant="outlined" onClick={() => setAnularAbierto(true)} disabled={guardando}>
                Anular
              </Button>
            ) : null}
            {puedeEditar ? (
              <Button type="submit" variant="contained" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            ) : null}
          </>
        }
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {anulada ? (
            <Alert severity="warning">
              <div>{MENSAJE_ANULADA}</div>
              {reparacion?.anulada_motivo ? <div>{`Motivo: ${reparacion.anulada_motivo}`}</div> : null}
            </Alert>
          ) : null}
          {nivel === 'lectura' && !anulada ? <Alert severity="info">Tu rol puede ver esta reparación, no modificarla.</Alert> : null}
          {errorGeneral ? (
            <Alert
              severity="error"
              action={conflicto ? <Button color="inherit" size="small" onClick={() => void cargar()}>Recargar</Button> : undefined}
            >
              {errorGeneral}
            </Alert>
          ) : null}

          {reparacion ? (
            <Card>
              <CardHeader title={<Typography component="h2" variant="t3">Estado</Typography>} />
              <CardContent>
                <Stack spacing={2}>
                  {errorEstado ? <Alert severity="error">{errorEstado}</Alert> : null}
                  {avisosCliente.errorAvisar && avisosCliente.errorAvisar !== MENSAJE_CLIENTE_SIN_CORREO ? (
                    <Alert severity="error">{avisosCliente.errorAvisar}</Alert>
                  ) : null}
                  {/* Con `lectura` (o anulada) no se ofrece el selector: solo el estado actual en texto. */}
                  {nivel === 'edicion' && !anulada ? (
                    <TextField
                      select
                      label="Estado"
                      value={estadosElegibles.some((estado) => estado.id === reparacion.estado_id) ? reparacion.estado_id : ''}
                      onChange={(evento) => void elegirEstado(evento.target.value)}
                      disabled={!puedeCambiarEstado}
                      helperText={
                        cerrada
                          ? 'La reparación está cerrada: ya no admite cambios de estado.'
                          : estadoActual?.descripcion || undefined
                      }
                    >
                      {estadosElegibles.map((estado) => (
                        <MenuItem key={estado.id} value={estado.id}>
                          {estado.activo ? estado.nombre : `${estado.nombre} (desactivado)`}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <Typography variant="body2">{`Estado: ${reparacion.estado}`}</Typography>
                  )}
                  {puedeEditar && !cerrada ? (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={avisarAlCambiar && !clienteSinCorreo}
                          onChange={(evento) => setAvisarAlCambiar(evento.target.checked)}
                          disabled={!puedeCambiarEstado || clienteSinCorreo}
                        />
                      }
                      label="Avisar al cliente"
                    />
                  ) : null}
                  <Box>
                    <Typography component="h3" variant="t3" sx={{ mb: 1 }}>Historial de estados</Typography>
                    <HistorialEstados
                      eventos={historial}
                      error={errorHistorial}
                      onReintentar={reparacion ? () => void refrescarHistorial(reparacion.id) : undefined}
                    />
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={<Typography component="h2" variant="t3">Cliente y equipo</Typography>} />
            <CardContent>
              <Stack spacing={2}>
                <Box role="group" aria-labelledby="etiqueta-tienda">
                  <Typography id="etiqueta-tienda" variant="body2" sx={{ mb: 0.5 }}>Tienda</Typography>
                  {errorEmpresas ? (
                    <Alert severity="error">No pudimos cargar las tiendas. Recargá la página.</Alert>
                  ) : (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={formulario.empresa_id}
                      disabled={!esNueva || bloqueado}
                      onChange={(_evento, valor: string | null) => valor && cambiar('empresa_id', valor)}
                      aria-label="Tienda"
                      sx={{ flexWrap: 'wrap' }}
                    >
                      {(esNueva ? empresas : [{ id: formulario.empresa_id, nombre: reparacion?.empresa ?? '' }]).map((empresa) => (
                        <ToggleButton key={empresa.id} value={empresa.id}>{empresa.nombre}</ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  )}
                  <Typography variant="caption" color={errores.empresa_id ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                    {errores.empresa_id ?? (esNueva ? 'Por defecto, la tienda activa. La numeración es propia de cada tienda.' : 'La tienda no se puede cambiar.')}
                  </Typography>
                </Box>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <ClienteSelector
                    valor={formulario.cliente}
                    onCambio={elegirCliente}
                    error={errores.cliente_id}
                    disabled={bloqueado}
                    onAltaRapida={puedeAltaRapida ? () => setAltaRapidaAbierta(true) : undefined}
                  />
                  <TextField
                    label="Contacto"
                    fullWidth
                    value={formulario.contacto}
                    onChange={(evento) => cambiar('contacto', evento.target.value)}
                    disabled={bloqueado}
                    error={Boolean(errores.contacto)}
                    helperText={errores.contacto}
                    slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_REPARACION.contacto } }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    select
                    label="Consola o equipo"
                    fullWidth
                    required
                    value={formulario.equipo}
                    onChange={(evento) => setFormulario((previo) => ({ ...previo, equipo: evento.target.value, modelo_id: '' }))}
                    disabled={bloqueado}
                    error={Boolean(errores.equipo)}
                    helperText={errores.equipo}
                  >
                    {equipos.map((equipo) => <MenuItem key={equipo} value={equipo}>{equipo}</MenuItem>)}
                  </TextField>
                  <TextField
                    select
                    label="Modelo"
                    fullWidth
                    required
                    value={formulario.modelo_id}
                    onChange={(evento) => cambiar('modelo_id', evento.target.value)}
                    disabled={bloqueado || formulario.equipo === ''}
                    error={Boolean(errores.modelo_id)}
                    helperText={errores.modelo_id ?? (formulario.equipo === '' ? 'Primero elegí la consola o el equipo.' : undefined)}
                  >
                    {modelosDelEquipo.map((modelo) => (
                      <MenuItem key={modelo.id} value={modelo.id}>{modelo.activo ? modelo.modelo : `${modelo.modelo} (desactivado)`}</MenuItem>
                    ))}
                  </TextField>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="N.º de serie"
                    fullWidth
                    value={formulario.numero_serie}
                    onChange={(evento) => cambiar('numero_serie', evento.target.value)}
                    disabled={bloqueado}
                    error={Boolean(errores.numero_serie)}
                    helperText={errores.numero_serie}
                    slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_REPARACION.numero_serie } }}
                  />
                  <TextField
                    label="Accesorios recibidos"
                    fullWidth
                    value={formulario.accesorios}
                    onChange={(evento) => cambiar('accesorios', evento.target.value)}
                    disabled={bloqueado}
                    error={Boolean(errores.accesorios)}
                    helperText={errores.accesorios}
                    slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_REPARACION.accesorios } }}
                  />
                </Stack>

                <TextField
                  label="Falla informada"
                  multiline
                  minRows={3}
                  value={formulario.falla}
                  onChange={(evento) => cambiar('falla', evento.target.value)}
                  disabled={bloqueado}
                  error={Boolean(errores.falla)}
                  helperText={errores.falla}
                  slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_REPARACION.falla } }}
                />
              </Stack>
            </CardContent>
          </Card>

          {conCostos ? (
            <Card>
              <CardHeader title={<Typography component="h2" variant="t3">Costo interno</Typography>} />
              <CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  {(['costo_mano_obra', 'costo_repuestos'] as const).map((campo) => (
                    <TextField
                      key={campo}
                      label={campo === 'costo_mano_obra' ? 'Costo mano de obra' : 'Costo repuestos'}
                      fullWidth
                      value={formulario[campo]}
                      onChange={(evento) => cambiar(campo, evento.target.value)}
                      disabled={bloqueado}
                      placeholder="0"
                      error={Boolean(errores[campo])}
                      helperText={errores[campo] ?? 'ARS, sin IVA.'}
                      slotProps={{
                        input: { endAdornment: <InputAdornment position="end">ARS</InputAdornment> },
                        htmlInput: { inputMode: 'decimal' },
                      }}
                    />
                  ))}
                </Stack>
                {reparacion?.ganancia_estimada != null ? (
                  <Box sx={{ bgcolor: 'action.hover', borderRadius: (tema) => tema.shape.borderRadius, p: 2, mt: 2 }}>
                    <Stack direction="row" justifyContent="space-between" spacing={2}>
                      <Typography variant="body2">Ganancia estimada</Typography>
                      <Typography component="span" variant="body2" sx={{ fontWeight: 700, userSelect: 'all', whiteSpace: 'nowrap' }}>
                        {formatearARS(reparacion.ganancia_estimada)}
                      </Typography>
                    </Stack>
                  </Box>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={<Typography component="h2" variant="t3">Técnico y fechas</Typography>} />
            <CardContent>
              <Stack spacing={2}>
                <TextField
                  select
                  label="Técnico"
                  value={formulario.tecnico_id}
                  onChange={(evento) => cambiar('tecnico_id', evento.target.value)}
                  disabled={bloqueado}
                  error={Boolean(errores.tecnico_id)}
                  helperText={errores.tecnico_id}
                >
                  <MenuItem value="">Sin asignar</MenuItem>
                  {formulario.tecnico_id !== '' && !tecnicos.some((tecnico) => tecnico.user_id === formulario.tecnico_id) ? (
                    <MenuItem value={formulario.tecnico_id}>Técnico asignado (ya no disponible)</MenuItem>
                  ) : null}
                  {tecnicos.map((tecnico) => <MenuItem key={tecnico.user_id} value={tecnico.user_id}>{tecnico.nombre}</MenuItem>)}
                </TextField>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Ingreso"
                    type="date"
                    fullWidth
                    value={formulario.ingreso_en}
                    onChange={(evento) => cambiar('ingreso_en', evento.target.value)}
                    disabled={bloqueado || esNueva}
                    error={Boolean(errores.ingreso_en)}
                    helperText={errores.ingreso_en ?? (esNueva ? 'Se registra con la fecha de hoy.' : undefined)}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: hoyEnArgentina() } }}
                  />
                  <TextField
                    label="Entrega prevista"
                    type="date"
                    fullWidth
                    value={formulario.entrega_prevista}
                    onChange={(evento) => cambiar('entrega_prevista', evento.target.value)}
                    disabled={bloqueado}
                    error={Boolean(errores.entrega_prevista)}
                    helperText={errores.entrega_prevista}
                    slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: formulario.ingreso_en || undefined } }}
                  />
                </Stack>
                {reparacion?.entrega_real ? (
                  <TextField
                    label="Entrega real"
                    type="date"
                    value={reparacion.entrega_real}
                    disabled
                    helperText="Se completa al entregar la reparación."
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                ) : null}
              </Stack>
            </CardContent>
          </Card>
          {reparacion ? (
            <ItemsReparacion
              reparacion={reparacion}
              puedeEditar={puedeEditarItems}
              onAgregarManoObra={() => setItemAbierto('mano_obra')}
              onAgregarRepuesto={() => setItemAbierto('repuesto')}
              onActualizada={aplicarOperacion}
              accionTotal={
                puedeGenerarComprobante ? (
                  <Stack spacing={1} sx={{ pt: 1 }}>
                    {cobro.errorGenerar ? <Alert severity="error">{cobro.errorGenerar}</Alert> : null}
                    <Button variant="contained" onClick={() => void cobro.generar()} disabled={cobro.generando}>
                      {cobro.generando ? 'Generando comprobante…' : 'Generar comprobante'}
                    </Button>
                  </Stack>
                ) : null
              }
            />
          ) : null}
          {reparacion ? (
            <AvisosReparacion
              avisos={avisosCliente.avisos}
              cargando={avisosCliente.cargando}
              error={avisosCliente.errorCarga}
              onReintentar={avisosCliente.recargar}
              puedeReenviar={puedeEditar && !clienteSinCorreo}
              avisando={avisosCliente.avisando}
              onReenviar={(estadoId) => void avisosCliente.avisar(estadoId)}
              sinCorreo={clienteSinCorreo || avisosCliente.errorAvisar === MENSAJE_CLIENTE_SIN_CORREO}
            />
          ) : null}
          {reparacion ? (
            <ComprobanteReparacion
              comprobante={cobro.comprobante}
              cargando={cobro.cargando}
              error={cobro.errorCarga}
              onReintentar={cobro.recargar}
              puedeVerEnVentas={nivelVentas === 'edicion' || nivelVentas === 'lectura'}
            />
          ) : null}
        </Stack>
      </ContenedorSeccion>
      </Box>

      <AltaRapidaClienteDialog
        abierto={altaRapidaAbierta}
        onCerrar={() => setAltaRapidaAbierta(false)}
        onCreado={(cliente, aviso) => {
          setAltaRapidaAbierta(false)
          elegirCliente(cliente)
          if (aviso) setExito(aviso)
        }}
      />
      {reparacion ? (
        <>
          <EntregaDialog
            abierto={estadoAEntregar !== null}
            reparacion={reparacion}
            estado={estadoAEntregar}
            onCerrar={() => setEstadoAEntregar(null)}
            onEntregada={(actualizada) => {
              setEstadoAEntregar(null)
              aplicarOperacion(actualizada, `Reparación ${actualizada.codigo} entregada`)
            }}
          />
          {itemAbierto !== null ? (
            <Suspense fallback={null}>
              {itemAbierto === 'mano_obra' ? (
                <AgregarManoObraDialog
                  abierto
                  reparacion={reparacion}
                  onCerrar={() => setItemAbierto(null)}
                  onAgregada={(actualizada) => {
                    setItemAbierto(null)
                    aplicarOperacion(actualizada, 'Mano de obra agregada')
                  }}
                />
              ) : (
                <AgregarRepuestoDialog
                  abierto
                  reparacion={reparacion}
                  onCerrar={() => setItemAbierto(null)}
                  onAviso={setExito}
                  onAgregada={(actualizada) => {
                    setItemAbierto(null)
                    aplicarOperacion(actualizada, mensajeRepuestoAgregado(actualizada))
                  }}
                />
              )}
            </Suspense>
          ) : null}
          <AnularDialog
            abierto={anularAbierto}
            reparacion={reparacion}
            onCerrar={() => setAnularAbierto(false)}
            onAnulada={(actualizada) => {
              setAnularAbierto(false)
              aplicarOperacion(actualizada, `Reparación ${actualizada.codigo} anulada`)
            }}
          />
        </>
      ) : null}
      <Snackbar open={exito !== null} autoHideDuration={4000} onClose={() => setExito(null)}>
        <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>
      </Snackbar>
    </Box>
  )
}
