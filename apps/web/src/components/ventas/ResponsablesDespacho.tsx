import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Card, CardContent, CardHeader, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../estados/EstadosPagina'
import {
  type ClaveResponsable,
  type DatosDespacho,
  type ResponsableDespacho,
  ETIQUETA_RESPONSABLE,
  MENSAJE_ERROR_CARGA_DESPACHO,
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
}

// Al cambiar de tienda se suelta lo elegido y se avisa: nunca se guarda un responsable de otra tienda.
export const AVISO_CAMBIO_DE_TIENDA = 'Cambiaste de tienda: el despacho se recargó para no mezclar datos de dos tiendas.'

export function ResponsablesDespacho({ comprobanteId, empresaId, operador, empresaActivaId, onCambio }: Props) {
  const [datos, setDatos] = useState<DatosDespacho | null>(null)
  const [candidatos, setCandidatos] = useState<ResponsableDespacho[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [elegido, setElegido] = useState('')
  const [avanzando, setAvanzando] = useState(false)
  // El ref frena el doble clic: el estado se actualiza después del clic.
  const enVuelo = useRef(false)
  const empresaPrevia = useRef<string | null | undefined>(undefined)

  const cargar = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)
    try {
      const estado = await obtenerDespachoComprobante(comprobanteId)
      setDatos(estado)
      const paso = proximoPaso(estado.estado_despacho)
      if (paso && estado.puede_despachar) {
        setCandidatos(await listarResponsablesDespacho(empresaId, paso.funcion))
      } else {
        setCandidatos([])
      }
    } catch (falla) {
      console.error(MENSAJE_ERROR_CARGA_DESPACHO, falla)
      setDatos(null)
      setCandidatos([])
      setErrorCarga(MENSAJE_ERROR_CARGA_DESPACHO)
    } finally {
      setCargando(false)
    }
  }, [comprobanteId, empresaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Cambio de tienda (Principio VIII, FR-012): se suelta lo elegido y se avisa.
  useEffect(() => {
    if (empresaPrevia.current === undefined) {
      empresaPrevia.current = empresaActivaId
      return
    }
    if (empresaPrevia.current !== empresaActivaId) {
      empresaPrevia.current = empresaActivaId
      setElegido('')
      setExito(null)
      setErrorAccion(null)
      setCandidatos([])
    }
  }, [empresaActivaId])

  const paso = proximoPaso(datos?.estado_despacho)
  const puedeDespachar = datos?.puede_despachar === true
  const estado = datos?.estado_despacho ?? null

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
    try {
      await cambiarEstadoDespacho({
        id: comprobanteId,
        estado: paso.estado,
        responsableId: elegido,
        actualizadoEn: datos?.updated_at ?? '',
      })
      setElegido('')
      setExito(MENSAJE_EXITO_DESPACHO)
      onCambio?.()
      await cargar()
    } catch (falla) {
      setErrorAccion(mensajeDeErrorDespacho(falla))
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
        disabled={!esSiguiente || !puedeDespachar || avanzando}
        onChange={(evento) => {
          setElegido(evento.target.value)
          setErrorAccion(null)
        }}
        slotProps={{ htmlInput: { 'aria-label': ETIQUETA_RESPONSABLE[clave] } }}
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
        {cargando ? <EstadoCargaPagina lineas={2} /> : null}
        {!cargando && errorCarga ? (
          <EstadoError titulo={errorCarga} reintentar={() => void cargar()} />
        ) : null}
        {!cargando && !errorCarga ? (
          <Stack spacing={1.5}>
            {estado ? (
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
                <EtiquetaEstado
                  texto={etiquetaEstadoDespacho(estado)}
                  variante={TONO_ESTADO_DESPACHO[estado] ?? 'neutral'}
                />
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

            {paso && puedeDespachar ? (
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
                <Button type="button" variant="contained" disabled={!elegido || avanzando} onClick={() => void avanzar()}>
                  {paso.etiqueta}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {`Responsable: ${paso.etiquetaResponsable}`}
                </Typography>
              </Stack>
            ) : null}
            {!puedeDespachar && estado ? (
              <Typography variant="caption" color="text.secondary">
                {MENSAJE_SIN_DESPACHO}
              </Typography>
            ) : null}
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  )
}
