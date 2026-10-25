import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Alert, AlertTitle, Box, Button, Dialog, DialogActions, DialogContent, FormControl, FormHelperText, InputLabel,
  MenuItem, Select, Stack, TextField, Typography,
} from '@mui/material'
import { listarDepositosActivos, listarStockPorDeposito, type DepositoOpcion, type StockPorDeposito } from '../../lib/depositos'
import { LARGO_MAXIMO_NOTA, TITULO_STOCK_INSUFICIENTE, esStockInsuficiente, fechaDeHoy } from '../../lib/stock'
import {
  MENSAJE_TRASLADO_REGISTRADO, avisoTrasladoInsuficiente, formularioTrasladoVacio, mensajeDeErrorTraslado, trasladarStock, validarTraslado,
  type ErroresTraslado, type FormularioTraslado, type ResultadoTraslado,
} from '../../lib/traslados'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { TituloDialogo } from '../../components/base/TituloDialogo'

export type ProductoTraslado = { id: string; nombre: string; sku: string | null }

type Props = {
  producto: ProductoTraslado
  onCerrar: () => void
  onRegistrado: () => void
}

// Diálogo «Trasladar» (F-STK-15, FR-025): mueve unidades de un depósito a otro sin cambiar el
// total. Se carga de forma diferida desde el listado y solo lo abre quien tiene edición en Stock.
// La acción no está en el prototipo (se diseña con el sistema de diseño). La autoridad de todas
// las reglas es public.trasladar_stock.
export default function TrasladarDialog({ producto, onCerrar, onRegistrado }: Props) {
  const [formulario, setFormulario] = useState<FormularioTraslado>(() => formularioTrasladoVacio())
  const [depositos, setDepositos] = useState<DepositoOpcion[]>([])
  const [stockPorDeposito, setStockPorDeposito] = useState<Record<string, StockPorDeposito>>({})
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoTraslado | null>(null)
  const [recarga, setRecarga] = useState(0)

  // Depósitos activos y cifras del producto en cada uno. Si falla no se adivina el disponible:
  // se ofrece reintentar y no se permite registrar.
  useEffect(() => {
    let vigente = true
    setCargando(true)
    setErrorCarga(false)
    Promise.all([listarDepositosActivos(), listarStockPorDeposito(producto.id)])
      .then(([activos, cifras]) => {
        if (!vigente) return
        setDepositos(activos)
        setStockPorDeposito(cifras)
        const porDefecto = activos.find((d) => d.por_defecto) ?? activos[0]
        setFormulario((previo) => previo.origen_id === '' ? { ...previo, origen_id: porDefecto?.id ?? '' } : previo)
        setCargando(false)
      })
      .catch((error) => {
        console.error('No pudimos preparar el traslado.', error)
        if (vigente) { setErrorCarga(true); setCargando(false) }
      })
    return () => { vigente = false }
  }, [producto.id, recarga])

  const origen = depositos.find((d) => d.id === formulario.origen_id) ?? null
  const destino = depositos.find((d) => d.id === formulario.destino_id) ?? null
  const stockOrigen = stockPorDeposito[formulario.origen_id] ?? null
  const disponibleOrigen = stockOrigen?.disponible ?? 0
  const errores: ErroresTraslado = intentoEnvio ? validarTraslado(formulario) : {}
  const aviso = useMemo(
    () => (formulario.origen_id === '' ? null : avisoTrasladoInsuficiente(disponibleOrigen, formulario.cantidad)),
    [formulario.origen_id, formulario.cantidad, disponibleOrigen],
  )
  const etiquetaProducto = producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre
  const hayUnSoloDeposito = !cargando && !errorCarga && depositos.length < 2

  const cerrar = () => {
    if (enviando) return
    onCerrar()
  }

  const registrar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enviando || aviso || errorCarga) return
    setIntentoEnvio(true)
    if (Object.keys(validarTraslado(formulario)).length > 0) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const respuesta = await trasladarStock({ productoId: producto.id, formulario })
      setResultado(respuesta)
      onRegistrado()
    } catch (error) {
      setErrorEnvio(mensajeDeErrorTraslado(error, 'No pudimos registrar el traslado. Intentá de nuevo.'))
      // Carrera: otro movimiento cambió el disponible. Se vuelve a leer para el reintento.
      if (esStockInsuficiente(error)) setRecarga((n) => n + 1)
    } finally {
      setEnviando(false)
    }
  }

  const selectorDeposito = (
    campo: 'origen_id' | 'destino_id',
    id: string,
    etiqueta: string,
    ayuda: string | undefined,
  ) => (
    <FormControl required error={Boolean(errores[campo])}>
      <InputLabel id={id}>{etiqueta}</InputLabel>
      <Select
        labelId={id}
        label={etiqueta}
        value={formulario[campo]}
        onChange={(evento) => setFormulario((previo) => ({ ...previo, [campo]: evento.target.value }))}
      >
        {depositos.map((opcion) => (
          <MenuItem key={opcion.id} value={opcion.id}>
            {opcion.nombre}{opcion.por_defecto ? ' (por defecto)' : ''}
          </MenuItem>
        ))}
      </Select>
      {errores[campo] ? <FormHelperText>{errores[campo]}</FormHelperText> : ayuda ? <FormHelperText>{ayuda}</FormHelperText> : null}
    </FormControl>
  )

  return (
    <Dialog open onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-trasladar">
      <Box component="form" onSubmit={(evento) => void registrar(evento)} noValidate>
        <TituloDialogo id="titulo-trasladar" onCerrar={cerrar}>Trasladar stock entre depósitos</TituloDialogo>
        <DialogContent>
          {resultado ? (
            <EstadoExito
              titulo={MENSAJE_TRASLADO_REGISTRADO}
              descripcion={
                `${producto.nombre}: ${origen?.nombre ?? 'origen'} queda con ${resultado.origen_cantidad} (disponible ${resultado.origen_disponible}) ` +
                `y ${destino?.nombre ?? 'destino'} con ${resultado.destino_cantidad} (disponible ${resultado.destino_disponible}).`
              }
            />
          ) : errorCarga ? (
            <EstadoError descripcion="No pudimos preparar el traslado." reintentar={() => setRecarga((n) => n + 1)} />
          ) : cargando ? (
            <EstadoCargaPagina />
          ) : hayUnSoloDeposito ? (
            <Alert severity="info">Para trasladar necesitás al menos dos depósitos activos. Creá otro en la pestaña «Depósitos de mercadería».</Alert>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {errorEnvio ? <EstadoError titulo="No pudimos registrar el traslado." descripcion={errorEnvio} /> : null}
              <TextField label="Producto" value={etiquetaProducto} slotProps={{ input: { readOnly: true } }} />
              {selectorDeposito(
                'origen_id',
                'deposito-origen',
                'Depósito de origen',
                origen && stockOrigen ? `Disponible en ${origen.nombre}: ${stockOrigen.disponible} · Stock ${stockOrigen.cantidad} · Reservado ${stockOrigen.reservado}` : origen ? `Disponible en ${origen.nombre}: 0` : undefined,
              )}
              {selectorDeposito(
                'destino_id',
                'deposito-destino',
                'Depósito de destino',
                destino ? `Stock en ${destino.nombre}: ${stockPorDeposito[destino.id]?.cantidad ?? 0}` : undefined,
              )}
              <TextField
                label="Cantidad"
                value={formulario.cantidad}
                onChange={(evento) => setFormulario((previo) => ({ ...previo, cantidad: evento.target.value }))}
                required
                error={Boolean(errores.cantidad) || Boolean(aviso)}
                helperText={errores.cantidad}
                slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-describedby': aviso ? 'aviso-traslado-insuficiente' : undefined } }}
              />
              {aviso ? (
                <Alert severity="error" id="aviso-traslado-insuficiente" role="alert">
                  <AlertTitle>{TITULO_STOCK_INSUFICIENTE}</AlertTitle>
                  {aviso}
                </Alert>
              ) : null}
              <TextField
                label="Fecha"
                type="date"
                value={formulario.fecha}
                onChange={(evento) => setFormulario((previo) => ({ ...previo, fecha: evento.target.value }))}
                required
                error={Boolean(errores.fecha)}
                helperText={errores.fecha}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: fechaDeHoy() } }}
              />
              <TextField
                label="Nota (opcional)"
                value={formulario.nota}
                onChange={(evento) => setFormulario((previo) => ({ ...previo, nota: evento.target.value }))}
                multiline
                minRows={2}
                error={Boolean(errores.nota)}
                helperText={errores.nota ?? `${formulario.nota.length}/${LARGO_MAXIMO_NOTA}`}
              />
              <Typography variant="body2" color="text.secondary">
                El traslado no cambia el stock total: deja una salida en el origen y una entrada en el destino.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {resultado ? (
            <Button variant="contained" onClick={cerrar}>Cerrar</Button>
          ) : (
            <>
              <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
              <Button type="submit" variant="contained" disabled={enviando || cargando || errorCarga || hayUnSoloDeposito || Boolean(aviso)}>
                {enviando ? 'Trasladando…' : 'Trasladar'}
              </Button>
            </>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  )
}
