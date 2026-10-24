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
  MENSAJE_CONFLICTO_COMPROBANTE,
  type CanalVenta,
  type ClienteComprobante,
  type ClienteElegidoComprobante,
  type Comprobante,
  type ErroresComprobante,
  type FormularioComprobante,
  type TipoComprobante,
} from '../../lib/ventas'
import { copiarPresupuesto } from '../../lib/ventasPresupuestos'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { ClienteSelector } from '../../components/service/ClienteSelector'
import { LineasComprobante } from '../../components/ventas/LineasComprobante'
import { ConfirmarFacturaDialog } from '../../components/ventas/ConfirmarFacturaDialog'
import { DialogoAnular } from '../../components/ventas/DialogoAnular'
import { DialogoNotaCredito } from '../../components/ventas/DialogoNotaCredito'
import { HistorialComprobante } from '../../components/ventas/HistorialComprobante'
import { TarjetaEstadoComprobante } from '../../components/ventas/TarjetaEstadoComprobante'
import { TarjetaNotaCredito } from '../../components/ventas/TarjetaNotaCredito'
import { formatearCuando } from '../../lib/actividad'
import {
  ETIQUETA_NOTA_CREDITO,
  MENSAJE_NOTA_EMITIDA,
  detalleAnulacionNotaCredito,
  type DetalleAnulacion,
} from '../../lib/notaCredito'
import { ETIQUETA_ANULAR } from '../../lib/anularComprobante'
import { ETIQUETA_CONFIRMAR_FACTURA, puedeConfirmarFactura } from '../../lib/ventasConfirmacion'
import {
  cambiarEstadoComprobante,
  definicionEstado,
  esConflictoDeEstado,
  mensajeDeCambioEstado,
  transicionesPermitidas,
  type EstadoComprobante,
} from '../../lib/estadosComprobante'
import { listarDepositos, type DepositoOpcion } from '../../lib/depositos'
import type { ProductoRepuesto } from '../../lib/reparacionItems'
import {
  aEntradas,
  conCambio,
  conProductoAgregado,
  guardarLineasComprobante,
  sinLinea,
  type EntradaLinea,
} from '../../lib/ventasLineas'

const RUTA_COMPROBANTES = '/ventas/comprobantes'
const SIN_DATO = '—'

// Ventas · Comprobante (F-VTA-05, FR-006): alta en `/ventas/comprobantes/nuevo` y edición en `/ventas/comprobantes/:id`.
// La autoridad de permisos y de edición es la base (RPC); acá `puede_editar` y `editable` solo deciden qué se ofrece.
// Esta historia entrega la cabecera. Quedan como espacios para las historias siguientes: las líneas y «Agregar
// producto» (F-VTA-06) y la acción «Confirmar factura» (F-VTA-07). Fuera de alcance (matriz pantalla↔criterios):
// impresión, nota de crédito, cobro, despacho y observaciones. El estado y su historial son de F-VTA-10. Forma de pago y envío se
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
  const [guardandoLineas, setGuardandoLineas] = useState(false)
  const [confirmandoFactura, setConfirmandoFactura] = useState(false)
  const [copiando, setCopiando] = useState(false)
  const [errorLineas, setErrorLineas] = useState<string | null>(null)
  const [depositos, setDepositos] = useState<DepositoOpcion[]>([])
  const [exito, setExito] = useState<string | null>((ubicacion.state as { mensaje?: string } | null)?.mensaje ?? null)
  const [clienteConsultado, setClienteConsultado] = useState<ClienteComprobante | null>(null)
  const [permitidos, setPermitidos] = useState<string[]>([])
  const [cambiandoEstado, setCambiandoEstado] = useState(false)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const [detalleAcciones, setDetalleAcciones] = useState<DetalleAnulacion | null>(null)
  const [anulandoAbierto, setAnulandoAbierto] = useState(false)
  const [notaAbierta, setNotaAbierta] = useState(false)
  const ultimaPeticion = useRef(0)
  const ultimaPeticionEstados = useRef(0)
  const ultimaPeticionDetalle = useRef(0)

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

  // Acciones y notas del detalle (F-VTA-11, FR-042/FR-045/FR-046): anulación, notas asociadas y qué líneas quedan
  // acreditables. Se relee al cambiar el comprobante (su `updated_at` avanza al emitir una nota) y al cambiar la
  // empresa activa (Principio VIII): nunca se ofrecen acciones con datos de otra tienda. Un fallo deja las acciones
  // ocultas: la base sigue siendo la autoridad y no se inventa nada.
  const comprobanteIdDetalle = comprobante?.id ?? null
  const comprobanteActualizadoEn = comprobante?.updated_at ?? null
  useEffect(() => {
    if (!comprobanteIdDetalle) {
      setDetalleAcciones(null)
      return
    }
    const peticion = ++ultimaPeticionDetalle.current
    setDetalleAcciones(null)
    detalleAnulacionNotaCredito(comprobanteIdDetalle)
      .then((detalle) => {
        if (peticion === ultimaPeticionDetalle.current) setDetalleAcciones(detalle)
      })
      .catch((error) => {
        if (peticion !== ultimaPeticionDetalle.current) return
        console.error('No pudimos leer las acciones y notas del comprobante.', error)
        setDetalleAcciones(null)
      })
  }, [comprobanteIdDetalle, comprobanteActualizadoEn, empresaActivaId])

  const alAnular = () => {
    setAnulandoAbierto(false)
    setExito(`Factura ${comprobante?.numero ?? ''} anulada`)
    void cargar()
  }

  const alEmitirNota = (nota: { numero: string }) => {
    setNotaAbierta(false)
    setExito(`${MENSAJE_NOTA_EMITIDA} ${nota.numero}`)
    void cargar()
  }

  // Depósitos de la tienda del comprobante (FR-013): son las opciones de «Depósito de mercadería» de cada línea.
  const empresaDelComprobante = comprobante?.empresa_id ?? null
  useEffect(() => {
    if (!empresaDelComprobante) {
      setDepositos([])
      return
    }
    let vigente = true
    listarDepositos(empresaDelComprobante)
      .then((lista) => {
        if (vigente) setDepositos(lista)
      })
      .catch((error) => {
        console.error('No pudimos cargar los depósitos de la tienda.', error)
        if (vigente) setDepositos([])
      })
    return () => {
      vigente = false
    }
  }, [empresaDelComprobante])

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

  // «Copiar» (F-VTA-08, FR-051): solo en un presupuesto, en cualquier estado. La copia es un presupuesto nuevo
  // `pendiente`; el original no cambia. Se abre la copia para editarla.
  const puedeCopiar = comprobante !== null && comprobante.tipo === 'presupuesto' && nivel === 'edicion' && comprobante.puede_editar
  async function copiar() {
    if (!comprobante || copiando) return
    setCopiando(true)
    setErrorGeneral(null)
    try {
      const copia = await copiarPresupuesto(comprobante.id)
      navigate(`/ventas/comprobantes/${copia.id}`, {
        state: { mensaje: `Copiaste el presupuesto ${comprobante.numero}: creamos el ${copia.numero}, listo para editar` },
      })
    } catch (error) {
      setErrorGeneral(mensajeDeErrorComprobante(error, 'No pudimos copiar el presupuesto.'))
    } finally {
      setCopiando(false)
    }
  }

  // Estados que el rol puede elegir (F-VTA-10, FR-024). Se relee cuando cambia el comprobante o la empresa activa
  // (Principio VIII): nunca quedan chips habilitados con datos de otra tienda. Un fallo deja todo deshabilitado.
  const comprobanteId = comprobante?.id ?? null
  const estadoActual = comprobante?.estado ?? null
  const actualizadoEn = comprobante?.updated_at ?? null
  const esFactura = comprobante?.tipo === 'factura'
  useEffect(() => {
    if (!comprobanteId || !esFactura) {
      setPermitidos([])
      return
    }
    const peticion = ++ultimaPeticionEstados.current
    setPermitidos([])
    transicionesPermitidas(comprobanteId)
      .then((lista) => {
        if (peticion === ultimaPeticionEstados.current) setPermitidos(lista)
      })
      .catch((error) => {
        console.error('No pudimos leer las transiciones de estado permitidas.', error)
      })
  }, [comprobanteId, esFactura, estadoActual, actualizadoEn, empresaActivaId])

  const elegirEstado = async (destino: EstadoComprobante) => {
    if (!comprobante || cambiandoEstado) return
    setCambiandoEstado(true)
    setErrorEstado(null)
    try {
      const nuevo = await cambiarEstadoComprobante(comprobante.id, destino, comprobante.updated_at)
      setComprobante((previo) => (previo ? { ...previo, estado: nuevo.estado, updated_at: nuevo.updated_at } : previo))
      setExito(`Estado: ${definicionEstado(nuevo.estado).etiqueta}`)
    } catch (error) {
      setErrorEstado(mensajeDeCambioEstado(error))
      if (esConflictoDeEstado(error)) void cargar()
    } finally {
      setCambiandoEstado(false)
    }
  }

  const cambiar = <C extends keyof FormularioComprobante>(campo: C, valor: FormularioComprobante[C]) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined, ...(campo === 'cliente' ? { cliente_id: undefined } : {}) }))
  }

  const elegirCliente = (cliente: ClienteElegidoComprobante | null) => cambiar('cliente', cliente)

  // Líneas (F-VTA-06, FR-010…FR-019). La base es la autoridad: cada cambio reemplaza las líneas con
  // `guardar_lineas_comprobante` (que recalcula precio, escala, IVA y totales) y se relee el comprobante.
  // Además de la cantidad, el depósito y el precio manual, el recálculo depende del CLIENTE: cambiar el
  // cliente en la cabecera vuelve a enviar las líneas para que tomen la lista del nuevo tipo de cliente.
  const puedeEditarLineas = puedeEditar && comprobante !== null && comprobante.editable

  const reemplazarLineas = async (entradas: EntradaLinea[]) => {
    if (!comprobante || guardandoLineas || !puedeEditarLineas) return
    setGuardandoLineas(true)
    setErrorLineas(null)
    try {
      await guardarLineasComprobante(comprobante.id, entradas, comprobante.updated_at)
      const actualizado = await obtenerComprobante(comprobante.id)
      setComprobante(actualizado)
    } catch (error) {
      if (esConflictoDeEdicion(error)) {
        setErrorLineas(MENSAJE_CONFLICTO_COMPROBANTE)
        void cargar()
      } else {
        setErrorLineas(mensajeDeErrorComprobante(error, 'No pudimos guardar las líneas del comprobante.'))
      }
    } finally {
      setGuardandoLineas(false)
    }
  }

  // Tras confirmar, la base ya descontó y reservó: se relee el comprobante, que queda de solo lectura (FR-037).
  const alConfirmarFactura = async () => {
    setConfirmandoFactura(false)
    try {
      const confirmado = await obtenerComprobante(comprobante?.id ?? '')
      setComprobante(confirmado)
      setFormulario(aFormulario(confirmado))
      setExito(`Factura ${confirmado.numero} confirmada`)
    } catch (error) {
      setErrorGeneral(mensajeDeErrorComprobante(error, 'La factura quedó confirmada, pero no pudimos recargarla. Recargá la página.'))
      void cargar()
    }
  }

  const cambiarLinea = (indice: number, cambio: Partial<EntradaLinea>) => {
    if (!comprobante) return
    void reemplazarLineas(conCambio(aEntradas(comprobante.lineas), indice, cambio))
  }

  const quitarLinea = (indice: number) => {
    if (!comprobante) return
    void reemplazarLineas(sinLinea(aEntradas(comprobante.lineas), indice))
  }

  const agregarProducto = (producto: ProductoRepuesto) => {
    if (!comprobante) return
    const depositoPorDefecto = depositos.find((deposito) => deposito.por_defecto)?.id ?? depositos[0]?.id ?? null
    void reemplazarLineas(conProductoAgregado(aEntradas(comprobante.lineas), producto.id, depositoPorDefecto))
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando || !puedeEditar) return
    const encontrados = validarComprobante(formulario, { esNuevo })
    setErrores(encontrados)
    setErrorGeneral(null)
    setErrorLineas(null)
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
        const clienteCambio = comprobante.cliente.id !== formulario.cliente?.id
        const guardado = await guardarComprobante(comprobante, formulario)
        if (guardado) {
          setComprobante(guardado)
          setFormulario(aFormulario(guardado))
          // El precio depende del tipo de cliente (FR-014): si cambió el cliente, se reenvían las líneas
          // para que tomen la lista nueva. Se hace después de guardar la cabecera (la base lee el cliente
          // guardado) y un fallo acá no oculta que la cabecera sí quedó guardada.
          if (clienteCambio && guardado.lineas.length > 0) {
            try {
              await guardarLineasComprobante(guardado.id, aEntradas(guardado.lineas), guardado.updated_at)
              const recalculado = await obtenerComprobante(guardado.id)
              setComprobante(recalculado)
            } catch (error) {
              setErrorLineas(mensajeDeErrorComprobante(error, 'Guardamos la cabecera, pero no pudimos recalcular las líneas.'))
            }
          }
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
  const estado = comprobante ? definicionEstado(comprobante.estado) : null

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
              {estado ? <EtiquetaEstado texto={estado.etiqueta} variante={estado.tono} /> : null}
              {/* Anular y Nota de crédito (F-VTA-11): la base decide si se ofrecen; sin permiso no se muestran. */}
              {comprobante && detalleAcciones?.puede_anular ? (
                <Button type="button" variant="outlined" color="error" onClick={() => setAnulandoAbierto(true)} disabled={guardando}>
                  {ETIQUETA_ANULAR}
                </Button>
              ) : null}
              {comprobante && detalleAcciones?.puede_emitir_nota_credito ? (
                <Button type="button" variant="outlined" onClick={() => setNotaAbierta(true)} disabled={guardando}>
                  {ETIQUETA_NOTA_CREDITO}
                </Button>
              ) : null}
              {puedeCopiar ? (
                <Button type="button" variant="outlined" onClick={() => void copiar()} disabled={copiando || guardando}>
                  {copiando ? 'Copiando…' : 'Copiar'}
                </Button>
              ) : null}
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
          {/* Anulación (FR-042): la factura anulada queda de solo lectura con su chip, el motivo y quién la anuló. */}
          {detalleAcciones?.anulacion ? (
            <Alert severity="info">
              {`Factura anulada el ${formatearCuando(detalleAcciones.anulacion.cuando)} por ${detalleAcciones.anulacion.quien}: «${detalleAcciones.anulacion.motivo}». El número no se reutiliza.`}
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

          {/* Líneas y «Agregar producto» (F-VTA-06): recién tienen sentido cuando el comprobante ya existe. */}
          {comprobante ? (
            <LineasComprobante
              lineas={comprobante.lineas}
              totales={{
                subtotal: comprobante.total_sin_iva,
                iva: comprobante.iva,
                total: comprobante.total_con_iva,
              }}
              depositos={depositos}
              editable={puedeEditarLineas && !guardando}
              puedeEditarPrecio={comprobante.puede_editar_precio}
              ocupado={guardandoLineas || guardando}
              error={errorLineas}
              onCambiar={cambiarLinea}
              onQuitar={quitarLinea}
              onAgregar={agregarProducto}
            />
          ) : (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="body2" color="text.secondary">
                  Guardá los datos del comprobante para agregar productos y ver los totales.
                </Typography>
              </CardContent>
            </Card>
          )}
          {/* Acciones del comprobante: «Confirmar factura» (F-VTA-07). Las demás llegan con sus historias. */}
          <Box data-testid="espacio-acciones">
            {comprobante && puedeConfirmarFactura(comprobante) && nivel === 'edicion' ? (
              <Button variant="contained" onClick={() => setConfirmandoFactura(true)} disabled={guardando || guardandoLineas}>
                {ETIQUETA_CONFIRMAR_FACTURA}
              </Button>
            ) : null}
          </Box>

          {/* Notas de crédito asociadas (F-VTA-11, FR-046): una tarjeta por nota, con cantidades e importes negativos. */}
          {detalleAcciones && detalleAcciones.notas.length > 0 ? (
            <Stack spacing={2}>
              {detalleAcciones.notas.map((nota) => (
                <TarjetaNotaCredito key={nota.id} nota={nota} />
              ))}
            </Stack>
          ) : null}

          {/* Estado y su historial (F-VTA-10): solo un comprobante ya guardado tiene estado. */}
          {comprobante && comprobante.tipo === 'factura' ? (
            <TarjetaEstadoComprobante
              estado={comprobante.estado}
              permitidos={permitidos}
              ocupado={cambiandoEstado || guardando}
              error={errorEstado}
              onElegir={(destino) => void elegirEstado(destino)}
            />
          ) : null}
          {comprobante ? (
            <HistorialComprobante
              comprobanteId={comprobante.id}
              claveRecarga={`${comprobante.updated_at}|${empresaActivaId ?? 'todas'}`}
            />
          ) : null}
        </Stack>
      </Box>

      {comprobante ? (
        <ConfirmarFacturaDialog
          open={confirmandoFactura}
          comprobante={comprobante}
          onCerrar={() => setConfirmandoFactura(false)}
          onConfirmado={() => void alConfirmarFactura()}
        />
      ) : null}

      {/* Si cambia la empresa activa, la pantalla navega al listado con aviso y estos diálogos se desmontan: jamás
          quedan datos de una tienda bajo otra (Principio VIII). */}
      {comprobante && detalleAcciones ? (
        <>
          <DialogoAnular
            open={anulandoAbierto && detalleAcciones.puede_anular}
            comprobante={comprobante}
            onCerrar={() => setAnulandoAbierto(false)}
            onAnulada={alAnular}
            onConflicto={() => void cargar()}
          />
          <DialogoNotaCredito
            open={notaAbierta && detalleAcciones.puede_emitir_nota_credito}
            factura={comprobante}
            lineas={detalleAcciones.lineas_acreditables}
            onCerrar={() => setNotaAbierta(false)}
            onEmitida={alEmitirNota}
          />
        </>
      ) : null}

      <Snackbar open={exito !== null} autoHideDuration={4000} onClose={() => setExito(null)}>
        <Alert severity="success" onClose={() => setExito(null)}>{exito}</Alert>
      </Snackbar>
    </Box>
  )
}
