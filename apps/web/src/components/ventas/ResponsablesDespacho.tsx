import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CardHeader, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../estados/EstadosPagina'
import {
  type ClaveResponsable,
  type DatosDespacho,
  type ResponsableDespacho,
  ETIQUETA_RESPONSABLE,
  MENSAJE_ERROR_CARGA_DESPACHO,
  MENSAJE_DESPACHO_SOLO_LECTURA,
  MENSAJE_EXITO_DESPACHO,
  MENSAJE_SIN_DESPACHO,
  MENSAJE_SIN_ESTADO_DESPACHO,
  PLACEHOLDER_RESPONSABLE,
  TONO_ESTADO_DESPACHO,
  ayudaEstadoDespacho,
  cambiarEstadoDespacho,
  etiquetaEstadoDespacho,
  idResponsable,
  listarResponsablesDespacho,
  mensajeDeErrorDespacho,
  nombreResponsable,
  obtenerDespachoComprobante,
  proximoPaso,
} from '../../lib/ventasDespacho'

// Tarjeta «Responsables» del comprobante (F-VTA-15, FR-010): el estado del despacho con su texto de ayuda, el
// operador (solo lectura) y quién armó, controló y entregó, con la acción para avanzar al siguiente paso.
// La autoridad es la base (`cambiar_estado_despacho` valida la transición, el responsable y el permiso); acá solo
// se presenta y se traducen los errores. El prototipo manda: los campos sin responsable muestran «Seleccionar».

type Props = {
  comprobanteId: string
  // Empresa del comprobante: de esa tienda salen los responsables elegibles.
  empresaId: string
  // Operador de la factura (solo lectura).
  operador: string
  // Empresa activa de la barra superior (Principio VIII, FR-012).
  empresaActivaId: string | null
  // Avisa a la pantalla que el despacho cambió, para que recargue el comprobante.
  onCambio?: () => void
  // La factura ya no admite cambios de despacho (quedó cobrada o con deuda): la tarjeta se sigue
  // leyendo pero no ofrece avanzar (la base solo despacha una factura confirmada, MSF-715).
  soloLectura?: boolean
  // Elegir el estado «Incompleto» abre el diálogo «Registrar faltantes» (F-VTA-18, FR-047).
  onRegistrarFaltantes?: () => void
  // Cambia cuando hay que volver a leer el despacho (cambio de estado, de empresa activa).
  claveRecarga?: string
}

// Al cambiar de tienda se suelta lo elegido, se avisa y se relee el despacho: nunca se guarda un responsable de otra tienda.
export const AVISO_CAMBIO_DE_TIENDA = 'Cambiaste de tienda: el despacho se recargó para no mezclar datos de dos tiendas.'

export function ResponsablesDespacho({ comprobanteId, empresaId, operador, empresaActivaId, onCambio, onRegistrarFaltantes, claveRecarga, soloLectura = false }: Props) {
  const [datos, setDatos] = useState<DatosDespacho | null>(null)
  const [candidatos, setCandidatos] = useState<ResponsableDespacho[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [elegido, setElegido] = useState('')
  const [avanzando, setAvanzando] = useState(false)
  // El ref frena el doble clic: el estado se actualiza después del clic.
  const enVuelo = useRef(false)
  // «Última petición gana»: una respuesta vieja (de otra tienda) no pisa la nueva.
  const ultimaPeticion = useRef(0)
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setErrorCarga(null)
    try {
      const estado = await obtenerDespachoComprobante(comprobanteId)
      const paso = proximoPaso(estado.estado_despacho)
      const candidatos =
        paso && estado.puede_despachar ? await listarResponsablesDespacho(empresaId, paso.funcion) : []
      if (peticion !== ultimaPeticion.current) return
      setDatos(estado)
      setCandidatos(candidatos)
    } catch (falla) {
      if (peticion !== ultimaPeticion.current) return
      console.error(MENSAJE_ERROR_CARGA_DESPACHO, falla)
      setDatos(null)
      setCandidatos([])
      setErrorCarga(MENSAJE_ERROR_CARGA_DESPACHO)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [comprobanteId, empresaId])

  useEffect(() => {
    void cargar()
    // `claveRecarga` no se usa dentro del efecto a propósito: es el disparador de la relectura.
  }, [cargar, claveRecarga])

  // Cambio de tienda (Principio VIII, FR-012): se suelta lo elegido, se avisa y se relee el despacho: jamás se
  // guarda un responsable de otra tienda.
  useEffect(() => {
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaAlAbrir.current === empresaActivaId) return
    empresaAlAbrir.current = empresaActivaId
    setElegido('')
    setExito(null)
    setErrorAccion(null)
    setCandidatos([])
    setAviso(AVISO_CAMBIO_DE_TIENDA)
    void cargar()
  }, [empresaActivaId, cargar])

  const paso = proximoPaso(datos?.estado_despacho)
  const puedeDespachar = datos?.puede_despachar === true
  const estado = datos?.estado_despacho ?? null
  // «Incompleto» (F-VTA-18, FR-047): se ofrece con la factura en Armando o Incompleto —lo que la
  // base acepta para registrar faltantes— y con permiso para despachar en la tienda del comprobante.
  // En solo lectura (factura cobrada) no se ofrece: la base lo rechaza.
  const puedeElegirIncompleto =
    Boolean(onRegistrarFaltantes) && !soloLectura && puedeDespachar && (estado === 'armando' || estado === 'incompleto')

  const opcionesDe = useMemo(
    () => (clave: ClaveResponsable): ResponsableDespacho[] => {
      const registrado = idResponsable(datos, clave)
      const nombre = nombreResponsable(datos, clave)
      const yaElegido = registrado
        ? [{ user_id: registrado, nombre, rol_id: '' }]
        : []
      const esSiguiente = paso?.responsable === clave
      const lista = esSiguiente && puedeDespachar ? candidatos : []
      return [...yaElegido, ...lista.filter((candidato) => candidato.user_id !== registrado)]
    },
    [candidatos, datos, paso, puedeDespachar],
  )

  const avanzar = async () => {
    if (!paso || !elegido || enVuelo.current) return
    enVuelo.current = true
    setAvanzando(true)
    setErrorAccion(null)
    setExito(null)
    // Empresa activa al enviar: si cambia mientras la base responde, el resultado es de otra tienda y no se muestra.
    const empresaAlEnviar = empresaAlAbrir.current
    try {
      await cambiarEstadoDespacho({
        id: comprobanteId,
        estado: paso.estado,
        responsableId: elegido,
        actualizadoEn: datos?.updated_at ?? '',
      })
      if (empresaAlAbrir.current !== empresaAlEnviar) return
      setElegido('')
      setExito(MENSAJE_EXITO_DESPACHO)
      onCambio?.()
      await cargar()
    } catch (falla) {
      if (empresaAlAbrir.current !== empresaAlEnviar) return
      setErrorAccion(mensajeDeErrorDespacho(falla))
      // Conflicto de concurrencia: el `updated_at` que se mandó quedó viejo. Sin releer, el reintento fallaría
      // otra vez por el mismo motivo, así que se suelta lo elegido y se vuelve a leer el despacho (el aviso
      // dice «Recargamos los datos»).
      if ((falla as { code?: string } | null)?.code === '40001') {
        setElegido('')
        await cargar()
      }
    } finally {
      enVuelo.current = false
      setAvanzando(false)
    }
  }

  const campoResponsable = (clave: ClaveResponsable) => {
    const registrado = idResponsable(datos, clave)
    const esSiguiente = paso?.responsable === clave
    const valor = esSiguiente ? elegido : (registrado ?? '')
    const opciones = opcionesDe(clave)
    return (
      <TextField
        key={clave}
        select
        label={ETIQUETA_RESPONSABLE[clave]}
        value={valor}
        size="small"
        fullWidth
        disabled={!esSiguiente || !puedeDespachar || avanzando || soloLectura}
        onChange={(evento) => {
          setElegido(evento.target.value)
          setErrorAccion(null)
        }}
        // Sin responsable elegido se ve «Seleccionar» (el prototipo), no un campo vacío.
        slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': ETIQUETA_RESPONSABLE[clave] } }}
      >
        <MenuItem value="">{PLACEHOLDER_RESPONSABLE}</MenuItem>
        {opciones.map((opcion) => (
          <MenuItem key={opcion.user_id} value={opcion.user_id}>
            {opcion.nombre}
          </MenuItem>
        ))}
      </TextField>
    )
  }

  return (
    <Card variant="outlined" component="section" aria-labelledby="titulo-responsables">
      <CardHeader
        title={<Typography id="titulo-responsables" component="h2" variant="t3">Responsables</Typography>}
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
              {estado ? (
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <EtiquetaEstado
                    texto={etiquetaEstadoDespacho(estado)}
                    variante={TONO_ESTADO_DESPACHO[estado] ?? 'neutral'}
                  />
                  {/* Elegir «Incompleto» abre el diálogo «Registrar faltantes» (FR-047): el estado no se
                      cambia a mano, se registra qué faltó y la base deja la factura Incompleta. */}
                  {puedeElegirIncompleto ? (
                    <Chip
                      label={estado === 'incompleto' ? 'Ajustar faltantes' : 'Incompleto'}
                      component="button"
                      type="button"
                      clickable
                      color="warning"
                      aria-label={
                        estado === 'incompleto'
                          ? 'Ajustar los faltantes de esta factura'
                          : 'Elegir el estado Incompleto y registrar los faltantes'
                      }
                      onClick={() => onRegistrarFaltantes?.()}
                    />
                  ) : null}
                  <Typography variant="caption" color="text.secondary" component="p">
                    {ayudaEstadoDespacho(estado)}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {MENSAJE_SIN_ESTADO_DESPACHO}
                </Typography>
              )}

              <TextField
                label="Operador"
                value={operador}
                size="small"
                fullWidth
                slotProps={{ input: { readOnly: true }, htmlInput: { 'aria-label': 'Operador' } }}
              />

              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Box sx={{ flex: '1 1 150px', minWidth: 0 }}>{campoResponsable('armo')}</Box>
                <Box sx={{ flex: '1 1 150px', minWidth: 0 }}>{campoResponsable('controlo')}</Box>
              </Stack>
              {campoResponsable('entrego')}

              {errorAccion ? <EstadoError titulo={errorAccion} /> : null}
              {exito ? <EstadoExito titulo={exito} /> : null}

              {paso && puedeDespachar && !soloLectura ? (
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <Button type="button" variant="contained" disabled={!elegido || avanzando} onClick={() => void avanzar()}>
                    {paso.etiqueta}
                  </Button>
                  <Typography variant="caption" color="text.secondary">
                    {`Responsable: ${paso.etiquetaResponsable}`}
                  </Typography>
                </Stack>
              ) : null}
              {soloLectura && estado ? (
                <Typography variant="caption" color="text.secondary">
                  {MENSAJE_DESPACHO_SOLO_LECTURA}
                </Typography>
              ) : null}
              {!puedeDespachar && estado && !soloLectura ? (
                <Typography variant="caption" color="text.secondary">
                  {MENSAJE_SIN_DESPACHO}
                </Typography>
              ) : null}
            </>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}
