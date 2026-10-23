import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import {
  AYUDA_CANAL_ML,
  CANALES_VENTA,
  ETIQUETA_TIPO,
  MENSAJE_CERRADO,
  aFormulario,
  crearComprobante,
  errorDeCampo,
  esComprobanteInexistente,
  esConflictoDeEdicion,
  formularioVacio,
  guardarComprobante,
  mensajeDeErrorComprobante,
  obtenerClienteParaComprobante,
  obtenerComprobante,
  validarComprobante,
  type CanalVenta,
  type ClienteComprobante,
  type ClienteElegidoComprobante,
  type Comprobante,
  type ErroresComprobante,
  type FormularioComprobante,
  type TipoComprobante,
} from '../../lib/ventas'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { ClienteSelector } from '../../components/service/ClienteSelector'

const RUTA_COMPROBANTES = '/ventas/comprobantes'
const SIN_DATO = '—'

function etiquetaEstado(comprobante: Comprobante): { texto: string; variante: 'neutral' | 'exito' | 'aviso' | 'info' } {
  switch (comprobante.estado) {
    case 'borrador':
      return { texto: 'Borrador', variante: 'neutral' }
    case 'confirmada':
      return { texto: 'Confirmada', variante: 'exito' }
    case 'pendiente':
      return { texto: 'Pendiente', variante: 'aviso' }
    case 'aceptado':
      return { texto: 'Aceptado', variante: 'info' }
    default:
      return { texto: comprobante.estado, variante: 'neutral' }
  }
}

// Ventas · Comprobante (F-VTA-05, FR-006): alta en `/ventas/comprobantes/nuevo` y edición en `/ventas/comprobantes/:id`.
// La autoridad de permisos y de edición es la base (RPC); acá `puede_editar` y `editable` solo deciden qué se ofrece.
// Esta historia entrega la cabecera. Quedan como espacios para las historias siguientes: las líneas y «Agregar
// producto» (F-VTA-06) y la acción «Confirmar factura» (F-VTA-07). Fuera de alcance (matriz pantalla↔criterios):
// impresión, nota de crédito, cobro, despacho, observaciones e historial de estados. Forma de pago y envío se
// guardan en la base (FR-005) pero se eligen cuando los catálogos de MSF-139 existan en esta base.
export function ComprobanteVenta() {
  const { id } = useParams()
  const esNuevo = id === undefined
  const navigate = useNavigate()
  const ubicacion = useLocation()
  const [parametros] = useSearchParams()
  const tipoInicial: TipoComprobante = parametros.get('tipo') === 'presupuesto' ? 'presupuesto' : 'factura'
  const { nivel } = useNivelSeccion('ventas')
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresasAccesibles()

  const [comprobante, setComprobante] = useState<Comprobante | null>(null)
  const [cargado, setCargado] = useState(esNuevo)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<FormularioComprobante>(() => formularioVacio(tipoInicial, ''))
  const [errores, setErrores] = useState<ErroresComprobante>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState<string | null>((ubicacion.state as { mensaje?: string } | null)?.mensaje ?? null)
  const [clienteConsultado, setClienteConsultado] = useState<ClienteComprobante | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!id) return
    const peticion = ++ultimaPeticion.current
    setErrorCarga(null)
    try {
      const existente = await obtenerComprobante(id)
      if (peticion !== ultimaPeticion.current) return
      setComprobante(existente)
      setFormulario(aFormulario(existente))
      setCargado(true)
    } catch (error) {
      if (peticion !== ultimaPeticion.current) return
      setErrorCarga(
        esComprobanteInexistente(error)
          ? 'Ese comprobante no existe o no pertenece a tu organización.'
          : mensajeDeErrorComprobante(error, 'No pudimos cargar el comprobante.'),
      )
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Empresa activa (Principio VIII, FR-007). Un comprobante nuevo sigue a la tienda activa de la barra superior;
  // uno guardado pertenece a una sola tienda, así que si la barra pasa a otra se cierra con aviso: jamás se
  // muestran ni se guardan datos de una tienda bajo la otra.
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)
  const cambioDuranteCarga = useRef(false)
  useEffect(() => {
    if (cargandoEmpresas) return
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      if (esNuevo && empresaActivaId) {
        setFormulario((previo) => (previo.empresa_id === '' ? { ...previo, empresa_id: empresaActivaId } : previo))
      }
      return
    }
    if (empresaActivaId === empresaAlAbrir.current) {
      if (cambioDuranteCarga.current && comprobante) {
        cambioDuranteCarga.current = false
        if (empresaActivaId && empresaActivaId !== comprobante.empresa_id) {
          navigate(RUTA_COMPROBANTES, {
            replace: true,
            state: { mensaje: 'Cambiaste de tienda: cerramos el comprobante para no mezclar datos de dos tiendas.' },
          })
        }
      }
      return
    }
    empresaAlAbrir.current = empresaActivaId
    if (esNuevo) {
      setFormulario((previo) => ({ ...previo, empresa_id: empresaActivaId ?? '' }))
      setErrores((previos) => ({ ...previos, empresa_id: undefined }))
    } else if (!comprobante) {
      // Todavía cargando: se recuerda el cambio y se resuelve en cuanto llegue el comprobante.
      cambioDuranteCarga.current = true
    } else if (empresaActivaId && empresaActivaId !== comprobante.empresa_id) {
      navigate(RUTA_COMPROBANTES, {
        replace: true,
        state: { mensaje: 'Cambiaste de tienda: cerramos el comprobante para no mezclar datos de dos tiendas.' },
      })
    }
  }, [cargandoEmpresas, empresaActivaId, esNuevo, comprobante, navigate])

  // Datos de lectura del cliente (CUIT / DNI, dirección de entrega): los del comprobante guardado o, si la
  // persona eligió otro cliente, los que se consultan acá.
  const clienteId = formulario.cliente?.id ?? null
  useEffect(() => {
    if (!clienteId || clienteId === comprobante?.cliente.id) return
    let vigente = true
    obtenerClienteParaComprobante(clienteId)
      .then((datos) => {
        if (vigente) setClienteConsultado(datos)
      })
      .catch((error) => {
        console.error('No pudimos leer los datos del cliente.', error)
        if (vigente) setClienteConsultado(null)
      })
    return () => {
      vigente = false
    }
  }, [clienteId, comprobante])

  const clienteVisible: ClienteComprobante | null =
    clienteId && comprobante && clienteId === comprobante.cliente.id
      ? comprobante.cliente
      : clienteConsultado && clienteConsultado.id === clienteId
        ? clienteConsultado
        : null

  const puedeEditar = nivel === 'edicion' && (esNuevo || (comprobante?.puede_editar === true && comprobante.editable))
  const cerrado = comprobante !== null && !comprobante.editable
  const bloqueado = !puedeEditar || guardando

  const cambiar = <C extends keyof FormularioComprobante>(campo: C, valor: FormularioComprobante[C]) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined, ...(campo === 'cliente' ? { cliente_id: undefined } : {}) }))
  }

  const elegirCliente = (cliente: ClienteElegidoComprobante | null) => cambiar('cliente', cliente)

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando || !puedeEditar) return
    const encontrados = validarComprobante(formulario, { esNuevo })
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
      if (esNuevo) {
        const creado = await crearComprobante(formulario)
        navigate(`${RUTA_COMPROBANTES}/${creado.id}`, {
          replace: true,
          state: { mensaje: `${ETIQUETA_TIPO[creado.tipo]} ${creado.numero} creado` },
        })
      } else if (comprobante) {
        const guardado = await guardarComprobante(comprobante, formulario)
        if (guardado) {
          setComprobante(guardado)
          setFormulario(aFormulario(guardado))
          setExito('Cambios guardados')
        } else {
          // Guardó, pero no pudimos releer: se pide recargar (el `updated_at` local ya quedó viejo).
          setConflicto(true)
          setErrorGeneral('Guardado; recargá para ver el estado actual del comprobante.')
        }
      }
    } catch (error) {
      const deCampo = errorDeCampo(error)
      if (deCampo) {
        setErrores({ [deCampo.campo]: deCampo.mensaje })
      } else if (esConflictoDeEdicion(error)) {
        setConflicto(true)
        setErrorGeneral(mensajeDeErrorComprobante(error, 'No pudimos guardar el comprobante.'))
      } else {
        setErrorGeneral(mensajeDeErrorComprobante(error, esNuevo ? 'No pudimos crear el comprobante.' : 'No pudimos guardar el comprobante.'))
      }
    } finally {
      setGuardando(false)
    }
  }

  const titulo = comprobante
    ? `${ETIQUETA_TIPO[comprobante.tipo]} ${comprobante.numero}`
    : formulario.tipo === 'presupuesto'
      ? 'Nuevo presupuesto'
      : 'Nuevo comprobante'
  const estado = comprobante ? etiquetaEstado(comprobante) : null

  const volver = (
    <Button component={RouterLink} to={RUTA_COMPROBANTES} variant="outlined" size="small" sx={{ mb: 1.5 }}>
      Comprobantes
    </Button>
  )

  if (errorCarga) {
    return (
      <Box>
        {volver}
        <EstadoError descripcion={errorCarga} reintentar={() => void cargar()} />
      </Box>
    )
  }
  if (!cargado || cargandoEmpresas) return <EstadoCargaPagina />

  return (
    <Box>
      <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate aria-label={titulo}>
        {volver}
        <EncabezadoPagina
          titulo={titulo}
          descripcion={comprobante ? `${comprobante.empresa} · ${comprobante.cliente.nombre}` : undefined}
          accion={
            <>
              {estado ? <EtiquetaEstado texto={estado.texto} variante={estado.variante} /> : null}
              {puedeEditar ? (
                <Button type="submit" variant="contained" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              ) : null}
            </>
          }
          contexto={<ContextoOrganizacionActiva />}
        />
        <Stack spacing={2}>
          {cerrado ? <Alert severity="warning">{MENSAJE_CERRADO}</Alert> : null}
          {nivel === 'lectura' && !cerrado ? <Alert severity="info">Tu rol puede ver este comprobante, no modificarlo.</Alert> : null}
          {errorGeneral ? (
            <Alert
              severity="error"
              action={conflicto ? <Button color="inherit" size="small" onClick={() => void cargar()}>Recargar</Button> : undefined}
            >
              {errorGeneral}
            </Alert>
          ) : null}

          <Card variant="outlined">
            <CardHeader title={<Typography component="h2" variant="t3">Datos del comprobante</Typography>} />
            <CardContent>
              <Stack spacing={2}>
                {esNuevo ? (
                  <Box role="group" aria-labelledby="etiqueta-tipo">
                    <Typography id="etiqueta-tipo" variant="body2" sx={{ mb: 0.5 }}>Tipo de comprobante</Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={formulario.tipo}
                      disabled={bloqueado}
                      onChange={(_evento, valor: TipoComprobante | null) => valor && cambiar('tipo', valor)}
                      aria-label="Tipo de comprobante"
                    >
                      <ToggleButton value="factura">Factura</ToggleButton>
                      <ToggleButton value="presupuesto">Presupuesto</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                ) : null}

                <Box role="group" aria-labelledby="etiqueta-tienda">
                  <Typography id="etiqueta-tienda" variant="body2" sx={{ mb: 0.5 }}>Tienda</Typography>
                  {errorEmpresas ? (
                    <Alert severity="error">No pudimos cargar las tiendas. Recargá la página.</Alert>
                  ) : (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={formulario.empresa_id}
                      disabled={!esNuevo || bloqueado}
                      onChange={(_evento, valor: string | null) => valor && cambiar('empresa_id', valor)}
                      aria-label="Tienda"
                      sx={{ flexWrap: 'wrap' }}
                    >
                      {(esNuevo ? empresas : [{ id: formulario.empresa_id, nombre: comprobante?.empresa ?? '' }]).map((empresa) => (
                        <ToggleButton key={empresa.id} value={empresa.id}>{empresa.nombre}</ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  )}
                  <Typography variant="caption" color={errores.empresa_id ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                    {errores.empresa_id ??
                      (esNuevo
                        ? 'Por defecto, la tienda activa. Una vez guardado, el comprobante queda en esa tienda y no se puede cambiar.'
                        : 'La tienda no se puede cambiar: el comprobante pertenece a una sola tienda.')}
                  </Typography>
                </Box>

                <Box role="group" aria-labelledby="etiqueta-canal">
                  <Typography id="etiqueta-canal" variant="body2" sx={{ mb: 0.5 }}>Canal de venta</Typography>
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={formulario.canal}
                    disabled={bloqueado}
                    onChange={(_evento, valor: CanalVenta | null) => valor && cambiar('canal', valor)}
                    aria-label="Canal de venta"
                    sx={{ flexWrap: 'wrap' }}
                  >
                    {CANALES_VENTA.map((canal) => (
                      <ToggleButton key={canal.valor} value={canal.valor}>{canal.etiqueta}</ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                  <Typography variant="caption" color={errores.canal ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                    {errores.canal ?? AYUDA_CANAL_ML}
                  </Typography>
                </Box>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
                  <ClienteSelector
                    valor={formulario.cliente}
                    onCambio={elegirCliente}
                    error={errores.cliente_id}
                    disabled={bloqueado}
                  />
                  <TextField
                    label="CUIT / DNI"
                    fullWidth
                    value={clienteVisible?.documento || SIN_DATO}
                    slotProps={{ input: { readOnly: true } }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="Condición frente al IVA"
                    fullWidth
                    value={SIN_DATO}
                    helperText="Todavía no se registra en la ficha del cliente."
                    slotProps={{ input: { readOnly: true } }}
                  />
                  <TextField
                    label="Dirección de entrega"
                    fullWidth
                    value={clienteVisible?.direccion || SIN_DATO}
                    slotProps={{ input: { readOnly: true } }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="Fecha"
                    type="date"
                    fullWidth
                    required
                    value={formulario.fecha}
                    onChange={(evento) => cambiar('fecha', evento.target.value)}
                    disabled={bloqueado}
                    error={Boolean(errores.fecha)}
                    helperText={errores.fecha}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  {formulario.tipo === 'presupuesto' ? (
                    <TextField
                      label="Válido hasta"
                      type="date"
                      fullWidth
                      value={formulario.valido_hasta}
                      onChange={(evento) => cambiar('valido_hasta', evento.target.value)}
                      disabled={bloqueado}
                      error={Boolean(errores.valido_hasta)}
                      helperText={errores.valido_hasta}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  ) : null}
                  <TextField
                    label="Operador"
                    fullWidth
                    value={comprobante?.operador ?? 'Vos'}
                    helperText={esNuevo ? 'Se registra con tu usuario al guardar.' : undefined}
                    slotProps={{ input: { readOnly: true } }}
                  />
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {/* Espacios de las historias siguientes: líneas y «Agregar producto» (F-VTA-06), acciones (F-VTA-07). */}
          <Box data-testid="espacio-lineas" />
          <Box data-testid="espacio-acciones" />
        </Stack>
      </Box>

      <Snackbar open={exito !== null} autoHideDuration={4000} onClose={() => setExito(null)}>
        <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>
      </Snackbar>
    </Box>
  )
}
