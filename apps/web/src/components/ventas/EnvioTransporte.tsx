import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CardHeader, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../estados/EstadosPagina'
import { obtenerDespachoComprobante, type EstadoDespacho } from '../../lib/ventasDespacho'
import {
  ETIQUETA_GUARDAR_ENVIO,
  MENSAJE_ERROR_CARGA_ENVIO,
  MENSAJE_EXITO_ENVIO,
  MENSAJE_FACTURA_ENTREGADA,
  MENSAJE_SIN_FORMA_ENVIO,
  MENSAJE_SIN_PERMISO_ENVIO,
  TEXTO_RETIRO_EN_LOCAL,
  esRetiroEnLocal,
  guardarEnvioComprobante,
  listarTransportesDeEmpresa,
  mensajeDeErrorEnvio,
  obtenerEnvioComprobante,
  obtenerFormaEnvioDeComprobante,
  obtenerTransportePorId,
  rotuloTransporte,
  transportesElegibles,
  validarGuia,
  type DatosEnvio,
  type FormaEnvioDelComprobante,
  type Transporte,
  type TransporteCargado,
} from '../../lib/ventasEnvio'

// Bloque «Envío y transporte» del comprobante (F-VTA-16, FR-023): el selector de transporte (con el rótulo que
// corresponde a la forma de envío), la guía y la fecha de envío; para «Retiro en local» el texto de que el
// cliente retira en el local. La autoridad es la base (`guardar_envio_comprobante` valida el transporte, la
// guía, el permiso y el bloqueo optimista); acá solo se presenta y se traducen los errores.
//
// La empresa activa manda (Principio VIII, FR-023): al cambiar de tienda se suelta lo elegido, se avisa y se
// relee el envío. Nunca se guarda un envío de una tienda bajo otra.

type Props = {
  comprobanteId: string
  // Empresa del comprobante: de esa tienda salen los transportes elegibles.
  empresaId: string
  // Forma de envío elegida en el comprobante (FR-005 de MSF-159): de ella salen el rótulo y si hace falta
  // transporte o guía.
  envioId: string | null
  // Empresa activa de la barra superior (Principio VIII, FR-023).
  empresaActivaId: string | null
  // Ventas en `edicion` en la empresa del comprobante (lo devuelve `obtener_comprobante`). El permiso
  // `despachar` lo resuelve la base en esa misma empresa.
  puedeEditar: boolean
  // Avisa a la pantalla que el envío cambió, para que recargue el comprobante (su `updated_at` avanzó).
  onCambio?: () => void
}

// Al cambiar de tienda se suelta lo elegido, se avisa y se relee el envío: nunca se guarda un envío de otra tienda.
export const AVISO_CAMBIO_DE_TIENDA_ENVIO =
  'Cambiaste de tienda: el envío se recargó para no mezclar datos de dos tiendas.'

// Por qué una opción del selector no se puede elegir: `null` si se puede.
type MotivoTransporte = 'desactivado' | 'otra_forma' | 'fuera_de_la_tienda'

// Lo que se le aclara a la persona en cada caso: el transporte cargado en la factura se muestra siempre (para
// saber qué salió), pero no se puede elegir si la base lo va a rechazar (FR-021).
const ETIQUETA_MOTIVO_TRANSPORTE: Readonly<Record<MotivoTransporte, string>> = {
  desactivado: ' (desactivado)',
  otra_forma: ' (no corresponde a esta forma de envío)',
  fuera_de_la_tienda: ' (no se usa en esta tienda)',
}

type OpcionTransporte = {
  id: string
  nombre: string
  // Por qué no se puede elegir: `null` si se puede.
  motivo: MotivoTransporte | null
}

export function EnvioTransporte({
  comprobanteId,
  empresaId,
  envioId,
  empresaActivaId,
  puedeEditar,
  onCambio,
}: Props) {
  const [forma, setForma] = useState<FormaEnvioDelComprobante | null>(null)
  const [datos, setDatos] = useState<DatosEnvio | null>(null)
  const [transportes, setTransportes] = useState<Transporte[]>([])
  // Transporte ya cargado en la factura que el catálogo de la tienda no trae (MSF-139 le quitó la tienda): se lee
  // por id para no dejar el selector en blanco.
  const [transporteFueraDeCatalogo, setTransporteFueraDeCatalogo] = useState<TransporteCargado | null>(null)
  const [estadoDespacho, setEstadoDespacho] = useState<EstadoDespacho | null>(null)
  const [puedeDespachar, setPuedeDespachar] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [errorGuia, setErrorGuia] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [transporteId, setTransporteId] = useState('')
  const [guia, setGuia] = useState('')
  const [fechaEnvio, setFechaEnvio] = useState('')
  const [guardando, setGuardando] = useState(false)
  // El ref frena el doble clic: el estado se actualiza después del clic.
  const enVuelo = useRef(false)
  // «Última petición gana»: una respuesta vieja (de otra tienda) no pisa la nueva.
  const ultimaPeticion = useRef(0)
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setErrorCarga(null)
    // Sin forma de envío no hay envío que cargar: el bloque solo avisa que falta elegirla (la elección de la
    // forma de envío es de MSF-159, FR-005).
    if (!envioId) {
      setCargando(false)
      setForma(null)
      setDatos(null)
      setTransportes([])
      setTransporteFueraDeCatalogo(null)
      setTransporteId('')
      setGuia('')
      setFechaEnvio('')
      return
    }
    setCargando(true)
    try {
      const formaEnvio = await obtenerFormaEnvioDeComprobante(empresaId, envioId)
      const envio = await obtenerEnvioComprobante(comprobanteId)
      const catalogo =
        formaEnvio && !esRetiroEnLocal(formaEnvio.tipo) ? await listarTransportesDeEmpresa(empresaId) : []
      if (peticion !== ultimaPeticion.current) return
      // El transporte ya cargado puede no estar en el catálogo de la tienda (MSF-139 reemplaza «Empresas donde se
      // usa» sin avisar a los comprobantes): se lee por id para que el selector muestre qué salió.
      const fueraDeCatalogo =
        envio?.transporte_id && !catalogo.some((transporte) => transporte.id === envio.transporte_id)
          ? await obtenerTransportePorId(envio.transporte_id)
          : null
      if (peticion !== ultimaPeticion.current) return
      setForma(formaEnvio)
      setDatos(envio)
      setTransportes(catalogo)
      setTransporteFueraDeCatalogo(fueraDeCatalogo)
      setTransporteId(envio?.transporte_id ?? '')
      setGuia(envio?.guia ?? '')
      setFechaEnvio(envio?.fecha_envio ?? '')
    } catch (falla) {
      if (peticion !== ultimaPeticion.current) return
      console.error(MENSAJE_ERROR_CARGA_ENVIO, falla)
      setForma(null)
      setDatos(null)
      setTransportes([])
      setTransporteFueraDeCatalogo(null)
      setErrorCarga(MENSAJE_ERROR_CARGA_ENVIO)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [comprobanteId, empresaId, envioId])

  // El permiso `despachar` lo resuelve la base en la empresa del comprobante (la RPC del despacho de F-VTA-15).
  // Si esa lectura falla se sigue sin permiso de despachar: la base es la autoridad y vuelve a verificar al
  // guardar, así que nunca se ofrece una acción que la base va a rechazar.
  useEffect(() => {
    if (!envioId) {
      setPuedeDespachar(false)
      setEstadoDespacho(null)
      return
    }
    let vigente = true
    obtenerDespachoComprobante(comprobanteId)
      .then((despacho) => {
        if (!vigente) return
        setPuedeDespachar(despacho.puede_despachar)
        // La factura entregada ya no admite cambios de envío (la base los rechaza siempre, FR-021).
        setEstadoDespacho(despacho.estado_despacho)
      })
      .catch((falla) => {
        console.error('No pudimos leer el permiso de despacho de esta factura.', falla)
        if (!vigente) return
        setPuedeDespachar(false)
        setEstadoDespacho(null)
      })
    return () => {
      vigente = false
    }
  }, [comprobanteId, envioId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cambio de tienda (Principio VIII, FR-023): se suelta lo elegido, se avisa y se relee el envío: jamás se
  // guarda un envío de una tienda bajo otra.
  useEffect(() => {
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaAlAbrir.current === empresaActivaId) return
    empresaAlAbrir.current = empresaActivaId
    setTransporteId('')
    setGuia('')
    setFechaEnvio('')
    setExito(null)
    setErrorAccion(null)
    setErrorGuia(null)
    setAviso(AVISO_CAMBIO_DE_TIENDA_ENVIO)
    void cargar()
  }, [empresaActivaId, cargar])

  const tipo = forma?.tipo ?? null
  // La factura entregada ya no admite cambios de envío: no se ofrece una acción que la base rechaza siempre.
  const entregado = estadoDespacho === 'entregado'
  const puedeGuardar = !entregado && (puedeEditar || puedeDespachar)

  const opciones = useMemo<OpcionTransporte[]>(() => {
    if (!forma) return []
    const elegibles = transportesElegibles(forma.tipo, transportes)
    const lista: OpcionTransporte[] = elegibles.map((transporte) => ({
      id: transporte.id,
      nombre: transporte.nombre,
      motivo: null,
    }))
    const agregar = (
      transporte: { id: string; nombre: string; activa: boolean },
      motivo: MotivoTransporte,
    ) => {
      if (lista.some((opcion) => opcion.id === transporte.id)) return
      lista.push({ id: transporte.id, nombre: transporte.nombre, motivo })
    }
    // El transporte ya cargado puede no ser elegible: se muestra (para saber qué salió) pero no se elige.
    const cargado = transportes.find((transporte) => transporte.id === datos?.transporte_id)
    if (cargado) {
      agregar(cargado, !cargado.activa ? 'desactivado' : 'otra_forma')
    }
    // Y puede haber salido del catálogo de la tienda: también se muestra, sin poder elegirlo.
    if (transporteFueraDeCatalogo) {
      agregar(transporteFueraDeCatalogo, transporteFueraDeCatalogo.activa ? 'fuera_de_la_tienda' : 'desactivado')
    }
    return lista
  }, [forma, transportes, datos, transporteFueraDeCatalogo])

  // La forma de envío dice si el transporte y la guía hacen falta: la base lo exige al entregar (FR-022).
  const falta = useMemo(() => {
    if (entregado) return null
    if (!forma?.exige_transporte_guia) return null
    const sinTransporte = transporteId === ''
    const sinGuia = guia.trim() === ''
    if (sinTransporte && sinGuia) {
      return 'Faltan el transporte y la guía: con esta forma de envío la factura no se puede entregar.'
    }
    if (sinTransporte) return 'Falta el transporte: con esta forma de envío la factura no se puede entregar.'
    if (sinGuia) return 'Falta la guía: con esta forma de envío la factura no se puede entregar.'
    return null
  }, [forma, transporteId, guia, entregado])

  const hayCambios =
    transporteId !== (datos?.transporte_id ?? '') ||
    guia.trim() !== (datos?.guia ?? '') ||
    fechaEnvio !== (datos?.fecha_envio ?? '')

  const guardar = async () => {
    if (!datos || guardando || enVuelo.current || !puedeGuardar) return
    const problemaGuia = validarGuia(guia)
    setErrorGuia(problemaGuia)
    if (problemaGuia) return
    enVuelo.current = true
    setGuardando(true)
    setErrorAccion(null)
    setExito(null)
    // Empresa activa al enviar: si cambia mientras la base responde, el resultado es de otra tienda y no se muestra.
    const empresaAlEnviar = empresaAlAbrir.current
    try {
      const guardado = await guardarEnvioComprobante({
        id: comprobanteId,
        transporteId: transporteId === '' ? null : transporteId,
        guia: guia.trim() === '' ? null : guia.trim(),
        fechaEnvio: fechaEnvio === '' ? null : fechaEnvio,
        actualizadoEn: datos.updated_at,
      })
      if (empresaAlAbrir.current !== empresaAlEnviar) return
      setDatos(guardado)
      setTransporteId(guardado.transporte_id ?? '')
      setGuia(guardado.guia ?? '')
      setFechaEnvio(guardado.fecha_envio ?? '')
      setExito(MENSAJE_EXITO_ENVIO)
      // El `updated_at` del comprobante avanzó: la pantalla recarga para no guardar con un valor viejo.
      onCambio?.()
    } catch (falla) {
      if (empresaAlAbrir.current !== empresaAlEnviar) return
      setErrorAccion(mensajeDeErrorEnvio(falla))
      // Conflicto de concurrencia: el `updated_at` que se mandó quedó viejo. Sin releer, el reintento fallaría
      // otra vez por el mismo motivo, así que se vuelve a leer el envío.
      if ((falla as { code?: string } | null)?.code === '40001') {
        await cargar()
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const rotulo = rotuloTransporte(tipo)

  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-envio">
      <CardHeader
        title={<Typography id="titulo-envio" component="h2" variant="t3">Envío y transporte</Typography>}
      />
      <CardContent>
        <Stack spacing={1.5}>
          {aviso ? (
            <Alert severity="info" onClose={() => setAviso(null)}>
              {aviso}
            </Alert>
          ) : null}
          {cargando ? <EstadoCargaPagina lineas={2} /> : null}
          {!cargando && errorCarga ? (
            <EstadoError titulo={errorCarga} reintentar={() => void cargar()} />
          ) : null}
          {!cargando && !errorCarga ? (
            <>
              {!forma ? (
                <Typography variant="body2" color="text.secondary">
                  {MENSAJE_SIN_FORMA_ENVIO}
                </Typography>
              ) : esRetiroEnLocal(tipo) ? (
                <Typography variant="body2" color="text.secondary">
                  {TEXTO_RETIRO_EN_LOCAL}
                </Typography>
              ) : (
                <>
                  <TextField
                    select
                    label={rotulo ?? 'Transporte'}
                    value={transporteId}
                    size="small"
                    fullWidth
                    disabled={!puedeGuardar || guardando}
                    onChange={(evento) => {
                      setTransporteId(evento.target.value)
                      setErrorAccion(null)
                    }}
                    slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': rotulo ?? 'Transporte' } }}
                  >
                    <MenuItem value="">Sin transporte</MenuItem>
                    {opciones.map((opcion) => (
                      <MenuItem key={opcion.id} value={opcion.id} disabled={opcion.motivo !== null}>
                        {opcion.nombre}
                        {opcion.motivo ? ETIQUETA_MOTIVO_TRANSPORTE[opcion.motivo] : ''}
                      </MenuItem>
                    ))}
                  </TextField>

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                    <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                      <TextField
                        label="Guía"
                        value={guia}
                        size="small"
                        fullWidth
                        disabled={!puedeGuardar || guardando}
                        onChange={(evento) => {
                          setGuia(evento.target.value)
                          setErrorGuia(validarGuia(evento.target.value))
                        }}
                        error={Boolean(errorGuia)}
                        helperText={errorGuia ?? undefined}
                        slotProps={{ htmlInput: { 'aria-label': 'Guía' } }}
                      />
                    </Box>
                    <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                      <TextField
                        label="Fecha de envío"
                        type="date"
                        value={fechaEnvio}
                        size="small"
                        fullWidth
                        disabled={!puedeGuardar || guardando}
                        onChange={(evento) => {
                          setFechaEnvio(evento.target.value)
                          setErrorAccion(null)
                        }}
                        slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'aria-label': 'Fecha de envío' } }}
                      />
                    </Box>
                  </Stack>

                  {entregado ? <Alert severity="info">{MENSAJE_FACTURA_ENTREGADA}</Alert> : null}
                  {falta ? <Alert severity="warning">{falta}</Alert> : null}
                  {errorAccion ? <EstadoError titulo={errorAccion} /> : null}
                  {exito ? <EstadoExito titulo={exito} /> : null}

                  {entregado ? null : puedeGuardar ? (
                    <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
                      <Button
                        type="button"
                        variant="contained"
                        disabled={!datos || !hayCambios || guardando}
                        onClick={() => void guardar()}
                      >
                        {guardando ? 'Guardando…' : ETIQUETA_GUARDAR_ENVIO}
                      </Button>
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {MENSAJE_SIN_PERMISO_ENVIO}
                    </Typography>
                  )}
                </>
              )}
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}
