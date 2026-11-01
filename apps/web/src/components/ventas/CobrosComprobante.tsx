import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, CardHeader, Dialog, DialogActions, DialogContent,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'
import { formatearImporteHistorial } from '../../lib/formatoHistorial'
import { formatearFecha } from '../../lib/formatoRanking'
import { etiquetaCuentaCobro } from '../../lib/ventas/cuentasCobro'
import { listarFormasPago, type FormaPago } from '../../lib/ventas/formasPago'
import { useListarCuentasCobro } from '../../hooks/useListarCuentasCobro'
import {
  FORMULARIO_COBRO_VACIO,
  codigoDeErrorCobro,
  errorDeCampoCobro,
  mensajeDeErrorCobro,
  registrarCobro,
  textoCuentaCobro,
  validarCobro,
  type Cobro,
  type ErroresCobro,
  type FormularioCobro,
  type SaldoComprobante,
} from '../../lib/ventas/cobros'

export const TITULO_REGISTRAR_COBRO = 'Registrar cobro'

// La lista de cobros es una grilla (como las líneas del comprobante): con `role="table"` el
// lector de pantalla anuncia las celdas y los encabezados.
const COLUMNAS = '104px minmax(140px, 1fr) minmax(160px, 1.2fr) 140px minmax(140px, 1fr)'
const ANCHO_MINIMO = 760

export type Props = {
  comprobanteId: string
  empresaId: string
  cobros: Cobro[]
  saldo: SaldoComprobante | null
  cargando: boolean
  error: string | null
  // Acción `registrar_cobro` de Ventas en la empresa del comprobante (FR-007): sin la acción
  // el botón no aparece (la base igual rechaza el registro).
  puedeRegistrarCobro: boolean
  // El diálogo lo abre y cierra la página: al cambiar de tienda se cierra con aviso (FR-009).
  dialogoAbierto: boolean
  onAbrirDialogo: () => void
  onCerrarDialogo: () => void
  onRecargar: () => void
  // Aviso de éxito para la pantalla (el Snackbar de la página).
  onRegistrado: (mensaje: string) => void
}

// Tarjeta «Cobros» del detalle del comprobante (F-VTA-12, FR-007). Muestra lo cobrado, lo que
// falta y el detalle de cada cobro; y, con la acción `registrar_cobro`, abre el diálogo para
// registrar uno parcial o total. La base es la autoridad: los importes, el saldo y el estado los
// recalcula ella; acá solo se ofrece y se muestra.
export function CobrosComprobante({
  comprobanteId, empresaId, cobros, saldo, cargando, error, puedeRegistrarCobro,
  dialogoAbierto, onAbrirDialogo, onCerrarDialogo, onRecargar, onRegistrado,
}: Props) {
  const pendiente = saldo?.saldo ?? null
  const sinSaldo = pendiente !== null && pendiente <= 0

  return (
    <Card variant="outlined">
      <CardHeader
        title={<Typography component="h2" variant="t3">Cobros</Typography>}
        action={
          puedeRegistrarCobro ? (
            <Button
              variant="contained"
              onClick={onAbrirDialogo}
              disabled={cargando || sinSaldo}
            >
              {TITULO_REGISTRAR_COBRO}
            </Button>
          ) : null
        }
      />
      <CardContent>
        {cargando ? <EstadoCargaPagina lineas={2} /> : null}
        {error ? <EstadoError descripcion={error} reintentar={onRecargar} /> : null}
        {!cargando && !error ? (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} role="group" aria-label="Totales de los cobros">
              <Dato titulo="Cobrado" valor={saldo ? formatearImporteHistorial(saldo.cobrado) : '—'} />
              <Dato titulo="Saldo" valor={saldo ? formatearImporteHistorial(saldo.saldo) : '—'} />
            </Stack>
            {sinSaldo ? (
              <Typography variant="body2" color="text.secondary">
                No queda saldo pendiente: la factura está cobrada.
              </Typography>
            ) : null}
            {cobros.length === 0 ? (
              <EstadoVacio
                titulo="Todavía no hay cobros"
                descripcion="Cuando se registre un cobro, aparece acá con su forma de pago, su importe y quién lo registró."
              />
            ) : (
              <ListaCobros cobros={cobros} />
            )}
          </Stack>
        ) : null}
      </CardContent>
      <DialogoRegistrarCobro
        open={dialogoAbierto}
        comprobanteId={comprobanteId}
        empresaId={empresaId}
        saldo={pendiente ?? 0}
        onCerrar={onCerrarDialogo}
        onRegistrado={onRegistrado}
        onRecargar={onRecargar}
      />
    </Card>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="p">
        {titulo}
      </Typography>
      <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
        {valor}
      </Typography>
    </Box>
  )
}

function ListaCobros({ cobros }: { cobros: Cobro[] }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box role="table" aria-label="Cobros del comprobante" sx={{ minWidth: ANCHO_MINIMO }}>
        <Box
          role="row"
          sx={{
            display: 'grid',
            gridTemplateColumns: COLUMNAS,
            gap: 1.25,
            px: 0,
            py: 1,
            borderTop: '1px solid',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography role="columnheader" variant="caption" color="text.secondary">Fecha</Typography>
          <Typography role="columnheader" variant="caption" color="text.secondary">Forma de pago</Typography>
          <Typography role="columnheader" variant="caption" color="text.secondary">Cuenta de cobro</Typography>
          <Typography role="columnheader" variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>Importe</Typography>
          <Typography role="columnheader" variant="caption" color="text.secondary">Registró</Typography>
        </Box>
        {cobros.map((cobro) => (
          <Box
            key={cobro.id}
            role="row"
            sx={{
              display: 'grid',
              gridTemplateColumns: COLUMNAS,
              gap: 1.25,
              alignItems: 'center',
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box role="cell">
              <Typography variant="body2">{formatearFecha(cobro.fecha.slice(0, 10))}</Typography>
            </Box>
            <Box role="cell" sx={{ minWidth: 0 }}>
              <Typography variant="body2">{cobro.forma_pago ?? '—'}</Typography>
            </Box>
            <Box role="cell" sx={{ minWidth: 0 }}>
              <Typography variant="body2">{textoCuentaCobro(cobro) ?? '—'}</Typography>
            </Box>
            <Box role="cell" sx={{ textAlign: 'right' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                {formatearImporteHistorial(cobro.importe)}
              </Typography>
            </Box>
            <Box role="cell" sx={{ minWidth: 0 }}>
              <Typography variant="body2">{cobro.registrado_por ?? '—'}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

type DialogoProps = {
  open: boolean
  comprobanteId: string
  empresaId: string
  saldo: number
  onCerrar: () => void
  onRegistrado: (mensaje: string) => void
  onRecargar: () => void
}

// Diálogo «Registrar cobro» (F-VTA-12, FR-007): forma de pago, cuenta de cobro (cuando la forma
// la exige) e importe, con el saldo como valor sugerido. Los errores de la base llegan con el
// nombre del campo (`hint`): se marcan donde están, no como un error general.
function DialogoRegistrarCobro({ open, comprobanteId, empresaId, saldo, onCerrar, onRegistrado, onRecargar }: DialogoProps) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-registrar-cobro">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido
        comprobanteId={comprobanteId}
        empresaId={empresaId}
        saldo={saldo}
        onCerrar={onCerrar}
        onRegistrado={onRegistrado}
        onRecargar={onRecargar}
      />
    </Dialog>
  )
}

function Contenido({ comprobanteId, empresaId, saldo, onCerrar, onRegistrado, onRecargar }: Omit<DialogoProps, 'open'>) {
  const [formulario, setFormulario] = useState<FormularioCobro>(FORMULARIO_COBRO_VACIO)
  const [errores, setErrores] = useState<ErroresCobro>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [formas, setFormas] = useState<FormaPago[]>([])
  const [cargandoFormas, setCargandoFormas] = useState(true)
  const [errorFormas, setErrorFormas] = useState<string | null>(null)
  const enVuelo = useRef(false)
  const refImporte = useRef<HTMLInputElement | null>(null)

  // Formas de pago de la tienda: el catálogo es de la empresa del comprobante.
  useEffect(() => {
    let vigente = true
    setCargandoFormas(true)
    setErrorFormas(null)
    listarFormasPago(empresaId)
      .then((lista) => {
        if (!vigente) return
        setFormas(lista.filter((forma) => forma.activo))
        setCargandoFormas(false)
      })
      .catch((error) => {
        if (!vigente) return
        console.error('No pudimos cargar las formas de pago.', codigoDeErrorCobro(error))
        setFormas([])
        setErrorFormas('No pudimos cargar las formas de pago de la tienda. Reintentá.')
        setCargandoFormas(false)
      })
    return () => {
      vigente = false
    }
  }, [empresaId])

  // El importe arranca con el saldo pendiente: es lo que se cobra por defecto.
  useEffect(() => {
    setFormulario({ ...FORMULARIO_COBRO_VACIO, importe: saldo > 0 ? String(saldo) : '' })
    setErrores({})
    setErrorGeneral(null)
  }, [saldo])

  const cuentas = useListarCuentasCobro({ empresaId, estado: 'activas', pagina: 1, tamano: 200 })
  const formaElegida = useMemo(
    () => formas.find((forma) => forma.id === formulario.forma_pago_id) ?? null,
    [formas, formulario.forma_pago_id],
  )
  const exigeCuenta = formaElegida?.exige_cuenta_cobro === true

  const cambiar = <K extends keyof FormularioCobro>(campo: K, valor: FormularioCobro[K]) => {
    setFormulario((actual) => ({ ...actual, [campo]: valor }))
    setErrores((actual) => ({ ...actual, [campo]: undefined }))
  }

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    setErrorGeneral(null)
    const encontrados = validarCobro(formulario, { saldo, exigeCuenta })
    setErrores(encontrados)
    if (Object.keys(encontrados).length > 0) {
      if (encontrados.importe) refImporte.current?.focus()
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      const cobro = await registrarCobro(comprobanteId, formulario)
      onRegistrado(`Cobro registrado · ${formatearImporteHistorial(cobro.importe)}`)
      onRecargar()
      onCerrar()
    } catch (error) {
      const deCampo = errorDeCampoCobro(error)
      if (deCampo) {
        setErrores({ [deCampo.campo]: deCampo.mensaje })
      } else {
        setErrorGeneral(mensajeDeErrorCobro(error, 'No pudimos registrar el cobro. Intentá de nuevo.'))
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const sinFormas = !cargandoFormas && errorFormas === null && formas.length === 0

  return (
    <Box component="form" onSubmit={(evento) => void enviar(evento)} noValidate>
      <TituloDialogo id="titulo-registrar-cobro" onCerrar={guardando ? undefined : onCerrar}>
        {TITULO_REGISTRAR_COBRO}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorGeneral ? <EstadoError titulo="No se registró el cobro." descripcion={errorGeneral} /> : null}
          {errorFormas ? <EstadoError descripcion={errorFormas} /> : null}
          {sinFormas ? (
            <Alert severity="info">
              La tienda no tiene formas de pago cargadas. Cargá una forma de pago en Configuración · Ventas para
              registrar cobros.
            </Alert>
          ) : null}
          <TextField
            select
            label="Forma de pago"
            fullWidth
            required
            value={formulario.forma_pago_id}
            onChange={(evento) => cambiar('forma_pago_id', evento.target.value)}
            disabled={guardando || cargandoFormas}
            error={Boolean(errores.forma_pago_id)}
            helperText={errores.forma_pago_id ?? (cargandoFormas ? 'Cargando formas de pago…' : undefined)}
          >
            {formas.map((forma) => (
              <MenuItem key={forma.id} value={forma.id}>
                {forma.nombre}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Cuenta de cobro"
            fullWidth
            value={formulario.cuenta_cobro_id}
            onChange={(evento) => cambiar('cuenta_cobro_id', evento.target.value)}
            disabled={guardando || cuentas.isLoading}
            error={Boolean(errores.cuenta_cobro_id)}
            helperText={
              errores.cuenta_cobro_id ??
              (cuentas.isError
                ? 'No pudimos cargar las cuentas de cobro de la tienda.'
                : exigeCuenta
                  ? 'La forma de pago elegida exige una cuenta de cobro.'
                  : 'Opcional: solo las formas de pago que lo exigen necesitan una cuenta.')
            }
          >
            {cuentas.cuentas.map((cuenta) => (
              <MenuItem key={cuenta.id} value={cuenta.id}>
                {etiquetaCuentaCobro(cuenta)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Importe"
            fullWidth
            required
            value={formulario.importe}
            onChange={(evento) => cambiar('importe', evento.target.value)}
            disabled={guardando}
            error={Boolean(errores.importe)}
            helperText={errores.importe ?? `Saldo pendiente: ${formatearImporteHistorial(saldo)}`}
            inputRef={refImporte}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={guardando || cargandoFormas || sinFormas}>
          {guardando ? 'Registrando…' : 'Registrar cobro'}
        </Button>
      </DialogActions>
    </Box>
  )
}
