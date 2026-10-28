import { useEffect, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { FORMAS_RMA, type FormaRma } from '../../lib/formasRma'
import { listarComprobantes, FILTROS_VACIOS } from '../../lib/ventasComprobantes'
import {
  MOTIVO_RMA_MAXIMO,
  OBSERVACIONES_RMA_MAXIMO,
  lineasDeComprobante,
  mensajeDeRma,
  registrarRma,
  type ComprobanteElegible,
  type LineaElegible,
} from '../../lib/rma'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  /** Tienda del listado ('' = todas): acota los comprobantes que se pueden elegir. */
  empresaId: string
  onCerrar: () => void
  onRegistrada: (forma: FormaRma) => void
}

const ESPERA_BUSQUEDA_MS = 300
const ESTADOS_SIN_RMA = ['borrador', 'anulada']

// Diálogo «Nueva devolución» (F-VTA-28, FR-005). Textos del prototipo `VentasDevoluciones.dc.html`: título, campos
// Comprobante / Ítem / Forma de RMA (con su descripción) / Motivo / Observaciones y Cancelar / Registrar devolución.
// La cantidad no está dibujada en el prototipo pero la base la exige (tope por línea): se pide con un campo del kit.
export function DialogoNuevaDevolucion({ open, empresaId, onCerrar, onRegistrada }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-nueva-devolucion">
      {/* El contenido se monta al abrir: cada apertura parte sin datos ni errores previos. */}
      <Contenido empresaId={empresaId} onCerrar={onCerrar} onRegistrada={onRegistrada} />
    </Dialog>
  )
}

type Errores = Partial<Record<'comprobante' | 'linea' | 'cantidad' | 'motivo' | 'observaciones', string>>

function Contenido({ empresaId, onCerrar, onRegistrada }: Omit<Props, 'open'>) {
  const [busqueda, setBusqueda] = useState('')
  const [opciones, setOpciones] = useState<ComprobanteElegible[]>([])
  const [cargandoOpciones, setCargandoOpciones] = useState(false)
  const [comprobante, setComprobante] = useState<ComprobanteElegible | null>(null)
  const [lineas, setLineas] = useState<LineaElegible[]>([])
  const [errorLineas, setErrorLineas] = useState(false)
  const [lineaId, setLineaId] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [forma, setForma] = useState<FormaRma>('cambio_directo')
  const [motivo, setMotivo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [errores, setErrores] = useState<Errores>({})
  const [error, setError] = useState<string | null>(null)
  const [registrando, setRegistrando] = useState(false)

  // Comprobantes elegibles (facturas no borrador ni anuladas) con espera al tipear. La base valida igual al registrar.
  useEffect(() => {
    let vigente = true
    setCargandoOpciones(true)
    const espera = setTimeout(() => {
      void (async () => {
        try {
          const pagina = await listarComprobantes({ ...FILTROS_VACIOS, busqueda, empresaId }, 1, 20)
          if (!vigente) return
          setOpciones(
            pagina.comprobantes
              .filter((c) => c.tipo === 'factura' && !ESTADOS_SIN_RMA.includes(c.estado))
              .map((c) => ({ id: c.id, numero: c.numero, cliente: c.cliente, empresa: c.empresa })),
          )
        } catch (falla) {
          if (!vigente) return
          console.error('No pudimos cargar los comprobantes.', falla)
          setOpciones([])
        }
        if (vigente) setCargandoOpciones(false)
      })()
    }, busqueda === '' ? 0 : ESPERA_BUSQUEDA_MS)
    return () => {
      vigente = false
      clearTimeout(espera)
    }
  }, [busqueda, empresaId])

  const elegirComprobante = (elegido: ComprobanteElegible | null) => {
    setComprobante(elegido)
    setLineas([])
    setLineaId('')
    setErrorLineas(false)
    setErrores((previos) => ({ ...previos, comprobante: undefined, linea: undefined }))
    if (!elegido) return
    void (async () => {
      try {
        const encontradas = await lineasDeComprobante(elegido.id)
        setLineas(encontradas)
      } catch (falla) {
        console.error('No pudimos cargar los ítems del comprobante.', falla)
        setErrorLineas(true)
      }
    })()
  }

  const lineaElegida = lineas.find((l) => l.id === lineaId)

  const validar = (): Errores => {
    const encontrados: Errores = {}
    if (!comprobante) encontrados.comprobante = 'Elegí el comprobante.'
    if (!lineaElegida) encontrados.linea = 'Elegí el ítem a devolver.'
    const unidades = Number(cantidad)
    if (!/^[0-9]+$/.test(cantidad.trim()) || unidades < 1) encontrados.cantidad = 'Ingresá una cantidad entera de al menos 1.'
    else if (lineaElegida && unidades > lineaElegida.cantidad) encontrados.cantidad = `No puede superar lo vendido (${lineaElegida.cantidad}).`
    if (motivo.trim() === '') encontrados.motivo = 'Escribí el motivo de la devolución.'
    else if (motivo.trim().length > MOTIVO_RMA_MAXIMO) encontrados.motivo = `El motivo no puede superar los ${MOTIVO_RMA_MAXIMO} caracteres.`
    if (observaciones.trim().length > OBSERVACIONES_RMA_MAXIMO) {
      encontrados.observaciones = `Las observaciones no pueden superar los ${OBSERVACIONES_RMA_MAXIMO} caracteres.`
    }
    return encontrados
  }

  const registrar = async () => {
    if (registrando) return
    const encontrados = validar()
    setErrores(encontrados)
    if (Object.keys(encontrados).length > 0 || !comprobante || !lineaElegida) return
    setRegistrando(true)
    setError(null)
    try {
      await registrarRma({ comprobanteId: comprobante.id, lineaId: lineaElegida.id, cantidad: Number(cantidad), formaRma: forma, motivo, observaciones })
      onRegistrada(forma)
    } catch (falla) {
      setError(mensajeDeRma(falla))
      setRegistrando(false)
    }
  }

  return (
    <>
      <TituloDialogo id="titulo-nueva-devolucion" onCerrar={registrando ? undefined : onCerrar}>
        Nueva devolución
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          <Autocomplete
            options={opciones}
            value={comprobante}
            loading={cargandoOpciones}
            disabled={registrando}
            onChange={(_, elegido) => elegirComprobante(elegido)}
            inputValue={busqueda}
            onInputChange={(_, texto, motivoCambio) => { if (motivoCambio === 'input' || motivoCambio === 'clear') setBusqueda(texto) }}
            filterOptions={(todas) => todas}
            getOptionLabel={(o) => `${o.numero} · ${o.cliente}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No hay facturas para elegir"
            loadingText="Buscando facturas…"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Comprobante"
                required
                placeholder="Buscá por número o cliente"
                error={Boolean(errores.comprobante)}
                helperText={errores.comprobante}
              />
            )}
          />

          <TextField
            select
            label="Ítem"
            required
            value={lineaId}
            onChange={(evento) => { setLineaId(evento.target.value); setErrores((previos) => ({ ...previos, linea: undefined, cantidad: undefined })) }}
            disabled={registrando || !comprobante || lineas.length === 0}
            error={Boolean(errores.linea) || errorLineas}
            helperText={errorLineas ? 'No pudimos cargar los ítems de la factura.' : errores.linea}
          >
            {lineas.map((l) => (
              <MenuItem key={l.id} value={l.id}>{`${l.descripcion} · ×${l.cantidad}`}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="Cantidad"
            required
            value={cantidad}
            onChange={(evento) => setCantidad(evento.target.value)}
            disabled={registrando}
            error={Boolean(errores.cantidad)}
            helperText={errores.cantidad}
            sx={{ width: 160 }}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />

          <FormControl>
            <FormLabel id="forma-rma">Forma de RMA</FormLabel>
            <RadioGroup aria-labelledby="forma-rma" value={forma} onChange={(evento) => setForma(evento.target.value as FormaRma)}>
              {FORMAS_RMA.map((definicion) => (
                <FormControlLabel
                  key={definicion.valor}
                  value={definicion.valor}
                  disabled={registrando}
                  control={<Radio />}
                  sx={{ alignItems: 'flex-start', border: 1, borderColor: forma === definicion.valor ? 'primary.main' : 'divider', borderRadius: 1, mb: 1, mx: 0, py: 0.5, pr: 1 }}
                  label={
                    <span>
                      <b>{definicion.etiqueta}</b>
                      <br />
                      <Typography component="span" variant="body2" color="text.secondary">{definicion.descripcion}</Typography>
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          </FormControl>

          <TextField
            label="Motivo"
            required
            value={motivo}
            onChange={(evento) => setMotivo(evento.target.value)}
            disabled={registrando}
            error={Boolean(errores.motivo)}
            helperText={errores.motivo}
          />
          <TextField
            label="Observaciones"
            multiline
            minRows={2}
            value={observaciones}
            onChange={(evento) => setObservaciones(evento.target.value)}
            disabled={registrando}
            error={Boolean(errores.observaciones)}
            helperText={errores.observaciones}
          />

          {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={registrando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void registrar()} disabled={registrando}>
          {registrando ? 'Registrando…' : 'Registrar devolución'}
        </Button>
      </DialogActions>
    </>
  )
}
