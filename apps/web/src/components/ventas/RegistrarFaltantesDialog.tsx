import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import type { Comprobante } from '../../lib/ventas'
import {
  type FaltanteARegistrar,
  esConflictoDeFaltantes,
  MENSAJE_ERROR_REGISTRAR,
  mensajeDeErrorFaltantes,
  registrarFaltantes,
  validarCantidadFaltante,
} from '../../lib/ventasFaltantes'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // La factura con sus líneas: de ahí salen las líneas donde se puede registrar un faltante.
  comprobante: Comprobante
  // Empresa activa de la barra superior (Principio VIII, FR-047): si cambia, el diálogo se cierra con aviso.
  empresaActivaId: string | null
  onCerrar: () => void
  // La base registró los faltantes: la pantalla relee el comprobante (queda Incompleto).
  onRegistrado: () => void
  // Otra persona cambió el comprobante (`40001`): la pantalla lo relee para que el reintento no repita el conflicto.
  onConflicto: () => void
  // La empresa activa cambió con el diálogo abierto: se cierra con aviso.
  onCambioEmpresa?: () => void
}

export const TITULO_REGISTRAR_FALTANTES = 'Registrar faltantes'
export const MENSAJE_SIN_LINEAS = 'Elegí al menos una línea con cantidad faltante.'
export const AVISO_CAMBIO_DE_TIENDA_FALTANTES =
  'Cambiaste de tienda: cerramos el registro de faltantes para no mezclar datos de dos tiendas.'

// Diálogo «Registrar faltantes» (F-VTA-18, FR-047). Marca, línea por línea, cuántas unidades faltaron
// del pedido: la base las registra (`registrar_faltantes_despacho`, FR-041) y deja la factura en
// Incompleto, todo o nada. Acá solo se validan los números y se traducen los errores.
//
// El diálogo no está en el prototipo (la matriz pantalla↔criterios lo declara): lo pide FR-047.
export function RegistrarFaltantesDialog({ open, comprobante, empresaActivaId, onCerrar, onRegistrado, onConflicto, onCambioEmpresa }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-registrar-faltantes">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido
        comprobante={comprobante}
        empresaActivaId={empresaActivaId}
        onCerrar={onCerrar}
        onRegistrado={onRegistrado}
        onConflicto={onConflicto}
        onCambioEmpresa={onCambioEmpresa}
      />
    </Dialog>
  )
}

function Contenido({ comprobante, empresaActivaId, onCerrar, onRegistrado, onConflicto, onCambioEmpresa }: Omit<Props, 'open'>) {
  // Cantidad escrita por línea (vacío = esa línea no tiene faltante).
  const [cantidades, setCantidades] = useState<Record<number, string>>({})
  const [errores, setErrores] = useState<Record<number, string | undefined>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [registrando, setRegistrando] = useState(false)
  // El ref frena el doble clic: el estado se actualiza después del clic.
  const enVuelo = useRef(false)
  // Empresa activa al abrir: si cambia, el diálogo se cierra con aviso (Principio VIII, FR-047).
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaAlAbrir.current === empresaActivaId) return
    empresaAlAbrir.current = empresaActivaId
    onCambioEmpresa?.()
  }, [empresaActivaId, onCambioEmpresa])

  const cambiar = (orden: number, valor: string) => {
    setCantidades((actuales) => ({ ...actuales, [orden]: valor }))
    setErrores((actuales) => ({ ...actuales, [orden]: undefined }))
    setErrorGeneral(null)
  }

  const registrar = async () => {
    if (enVuelo.current) return
    setErrorGeneral(null)

    // Solo las líneas con cantidad escrita se registran: una línea en blanco no es un faltante.
    const faltantes: FaltanteARegistrar[] = []
    const nuevosErrores: Record<number, string | undefined> = {}
    for (const linea of comprobante.lineas) {
      const texto = (cantidades[linea.orden] ?? '').trim()
      if (texto === '') continue
      const error = validarCantidadFaltante(texto, linea.cantidad)
      if (error) nuevosErrores[linea.orden] = error
      else faltantes.push({ linea_orden: linea.orden, cantidad: Number(texto) })
    }
    setErrores(nuevosErrores)
    if (Object.keys(nuevosErrores).length > 0) return
    if (faltantes.length === 0) {
      setErrorGeneral(MENSAJE_SIN_LINEAS)
      return
    }

    enVuelo.current = true
    setRegistrando(true)
    try {
      await registrarFaltantes({
        comprobanteId: comprobante.id,
        actualizadoEn: comprobante.updated_at,
        faltantes,
      })
      onRegistrado()
    } catch (falla) {
      setErrorGeneral(mensajeDeErrorFaltantes(falla, MENSAJE_ERROR_REGISTRAR))
      // El mensaje de conflicto promete una recarga: sin ella el reintento vuelve a fallar con el mismo `updated_at`.
      if (esConflictoDeFaltantes(falla)) onConflicto()
    } finally {
      enVuelo.current = false
      setRegistrando(false)
    }
  }

  return (
    <Box component="form" onSubmit={(evento) => { evento.preventDefault(); void registrar() }} noValidate>
      <TituloDialogo id="titulo-registrar-faltantes" onCerrar={registrando ? undefined : onCerrar}>
        {TITULO_REGISTRAR_FALTANTES} · {comprobante.numero}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">
            Marcá cuántas unidades faltaron de cada línea. La factura pasa a Incompleto y los faltantes
            quedan en Ventas · Faltantes hasta que se reanude el armado.
          </Typography>
          {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}

          <Stack spacing={1.5}>
            {comprobante.lineas.map((linea) => (
              <Stack
                key={linea.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ sm: 'center' }}
                useFlexGap
              >
                <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                  <Typography component="p" sx={{ fontWeight: 600 }}>{linea.descripcion}</Typography>
                  <Typography component="p" variant="caption" color="text.secondary">
                    {`Línea ${linea.orden} · se pidieron ${linea.cantidad} ${linea.cantidad === 1 ? 'unidad' : 'unidades'}`}
                  </Typography>
                </Box>
                <TextField
                  label="Cantidad faltante"
                  value={cantidades[linea.orden] ?? ''}
                  onChange={(evento) => cambiar(linea.orden, evento.target.value)}
                  error={Boolean(errores[linea.orden])}
                  helperText={errores[linea.orden] ?? 'En blanco = sin faltante'}
                  disabled={registrando}
                  size="small"
                  sx={{ flex: '0 1 180px', minWidth: 0 }}
                  slotProps={{
                    htmlInput: {
                      inputMode: 'numeric',
                      'aria-label': `Cantidad faltante de la línea ${linea.orden}: ${linea.descripcion}`,
                    },
                  }}
                />
              </Stack>
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={registrando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={registrando}>
          {registrando ? 'Registrando…' : 'Registrar faltantes'}
        </Button>
      </DialogActions>
    </Box>
  )
}
