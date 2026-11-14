import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, FormControl,
  Checkbox, FormControlLabel, FormLabel, Radio, RadioGroup, Stack, Typography,
} from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { ClienteSelector } from '../service/ClienteSelector'
import type { ClienteElegido } from '../../lib/reparaciones'
import {
  fusionarClientes, hayCuentaWebParaResolver, mensajeDeFusion, vistaPreviaFusion, type VistaPreviaCliente,
} from '../../lib/clientes'

export type ClienteAFusionar = { id: string; numero: number; nombre: string }

type Props = {
  abierto: boolean
  /** La ficha desde la que se abre: es una de las dos puntas de la fusión. */
  cliente: ClienteAFusionar
  onCerrar: () => void
  /** Se llama con el id de la ficha que quedó (la que se conserva) cuando la fusión terminó bien. */
  onFusionado: (conservadoId: string) => void
}

type EstadoVistaPrevia = { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'lista'; filas: VistaPreviaCliente[] }

const compras = (n: number) => (n === 1 ? '1 compra' : `${n} compras`)

// Diálogo «Fusionar clientes» (F-CLI-18, FR-013): buscar el otro cliente, elegir cuál ficha se conserva, ver la
// vista previa, resolver la cuenta web si hace falta y confirmar. La RPC es todo o nada.
export function DialogoFusionarClientes({ abierto, cliente, onCerrar, onFusionado }: Props) {
  const [otro, setOtro] = useState<ClienteElegido | null>(null)
  const [conservar, setConservar] = useState<'actual' | 'otro'>('actual')
  const [cuentaWebDe, setCuentaWebDe] = useState<'actual' | 'otro' | ''>('')
  const [previa, setPrevia] = useState<EstadoVistaPrevia | null>(null)
  const [entiendo, setEntiendo] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reintento, setReintento] = useState(0)

  const mismoCliente = otro?.id === cliente.id
  const otroId = otro && !mismoCliente ? otro.id : null

  // Reinicia todo al cerrar el diálogo (la próxima apertura empieza limpia).
  useEffect(() => {
    if (abierto) return
    setOtro(null); setConservar('actual'); setCuentaWebDe(''); setPrevia(null); setError(null); setEntiendo(false)
  }, [abierto])

  useEffect(() => {
    if (!abierto || !otroId) {
      setPrevia(null)
      return
    }
    let cancelada = false
    setPrevia({ estado: 'cargando' })
    setCuentaWebDe(''); setEntiendo(false)
    vistaPreviaFusion(cliente.id, otroId).then(
      (filas) => { if (!cancelada) setPrevia({ estado: 'lista', filas }) },
      (excepcion) => { if (!cancelada) setPrevia({ estado: 'error', mensaje: mensajeDeFusion(excepcion) }) },
    )
    return () => { cancelada = true }
  }, [abierto, cliente.id, otroId, reintento])

  const filas = previa?.estado === 'lista' ? previa.filas : null
  const filaDe = (id: string) => filas?.find((fila) => fila.cliente_id === id)
  const resolverCuenta = filas ? hayCuentaWebParaResolver(filas) : false
  const nombreOtro = otro?.nombre ?? ''
  const conservado = conservar === 'actual' ? cliente.id : otroId
  const descartado = conservar === 'actual' ? otroId : cliente.id
  const faltaCuenta = resolverCuenta && cuentaWebDe === ''
  const nombreConservado = conservar === 'actual' ? cliente.nombre : nombreOtro
  const nombreDescartado = conservar === 'actual' ? nombreOtro : cliente.nombre
  const nombreCuentaConservada = cuentaWebDe === 'actual' ? cliente.nombre : nombreOtro
  const nombreCuentaDeBaja = cuentaWebDe === 'actual' ? nombreOtro : cliente.nombre
  // Con dos cuentas web activas, la que no se elige se da de baja y no se recupera: hay que confirmarlo.
  const pideConfirmacion = resolverCuenta && cuentaWebDe !== ''
  const puedeConfirmar = Boolean(filas && conservado && descartado && !faltaCuenta && !procesando && (!pideConfirmacion || entiendo))

  const cerrar = () => { if (!procesando) onCerrar() }

  const confirmar = async () => {
    if (!puedeConfirmar || !conservado || !descartado) return
    setProcesando(true)
    setError(null)
    try {
      const cuenta = resolverCuenta ? (cuentaWebDe === 'actual' ? cliente.id : otroId) : null
      await fusionarClientes(conservado, descartado, cuenta)
      onFusionado(conservado)
    } catch (excepcion) {
      setError(mensajeDeFusion(excepcion))
    } finally {
      setProcesando(false)
    }
  }

  const etiquetaFila = (id: string, nombre: string, numero?: number) => {
    const fila = filaDe(id)
    const detalle = fila ? ` · ${compras(fila.documentos)}` : ''
    return `${numero !== undefined ? `Nº ${numero} · ` : ''}${nombre}${detalle}`
  }
  const numeroOtro = filaDe(otroId ?? '')?.numero

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-fusionar-clientes">
      <TituloDialogo id="titulo-fusionar-clientes" onCerrar={cerrar}>Fusionar clientes</TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            Unís las fichas de un mismo cliente: las compras y la cuenta web pasan a la ficha que se conserva y la otra
            queda archivada. No se puede deshacer.
          </DialogContentText>
          <Typography>Cliente actual: <strong>Nº {cliente.numero} · {cliente.nombre}</strong></Typography>
          <ClienteSelector valor={otro} onCambio={(nuevo) => { setOtro(nuevo); setError(null) }} disabled={procesando} />
          {mismoCliente ? <Alert severity="warning">Elegí un cliente distinto del actual.</Alert> : null}

          {previa?.estado === 'cargando' ? (
            <Stack direction="row" spacing={1} alignItems="center" role="status">
              <CircularProgress size={18} aria-hidden /> <span>Cargando la vista previa…</span>
            </Stack>
          ) : null}
          {previa?.estado === 'error' ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setReintento((n) => n + 1)}>Reintentar</Button>}>
              {previa.mensaje}
            </Alert>
          ) : null}

          {filas && otroId ? (
            <Stack spacing={2}>
              <FormControl>
                <FormLabel id="grupo-conservar">Ficha que se conserva</FormLabel>
                <RadioGroup aria-labelledby="grupo-conservar" value={conservar} onChange={(_e, valor) => { setConservar(valor as 'actual' | 'otro'); setEntiendo(false) }}>
                  <FormControlLabel value="actual" control={<Radio />} disabled={procesando}
                    label={etiquetaFila(cliente.id, cliente.nombre, cliente.numero)} />
                  <FormControlLabel value="otro" control={<Radio />} disabled={procesando}
                    label={etiquetaFila(otroId, nombreOtro, numeroOtro)} />
                </RadioGroup>
              </FormControl>
              <Typography color="text.secondary" role="status">
                {`${compras(filaDe(cliente.id)?.documentos ?? 0)} y ${compras(filaDe(otroId)?.documentos ?? 0)}: la ficha que se conserva quedará con ${compras((filaDe(cliente.id)?.documentos ?? 0) + (filaDe(otroId)?.documentos ?? 0))}.`}
              </Typography>
              {resolverCuenta ? (
                <FormControl required error={faltaCuenta}>
                  <FormLabel id="grupo-cuenta-web">Cuenta web que se mantiene</FormLabel>
                  <Box component="p" sx={{ m: 0, color: 'text.secondary' }}>
                    Los dos clientes tienen cuenta web activa. La que no elijas se da de baja.
                  </Box>
                  <RadioGroup aria-labelledby="grupo-cuenta-web" value={cuentaWebDe} onChange={(_e, valor) => { setCuentaWebDe(valor as 'actual' | 'otro'); setEntiendo(false) }}>
                    <FormControlLabel value="actual" control={<Radio />} disabled={procesando} label={`La de ${cliente.nombre}`} />
                    <FormControlLabel value="otro" control={<Radio />} disabled={procesando} label={`La de ${nombreOtro}`} />
                  </RadioGroup>
                </FormControl>
              ) : null}
              {pideConfirmacion ? (
                <Alert severity="warning" role="group" aria-labelledby="titulo-confirmar-baja">
                  <Typography id="titulo-confirmar-baja" component="p" sx={{ fontWeight: 600 }}>Antes de fusionar, revisá esto</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    <li>Se conserva la ficha de <strong>{nombreConservado}</strong>; la de <strong>{nombreDescartado}</strong> queda archivada.</li>
                    <li>Se conserva la cuenta web de <strong>{nombreCuentaConservada}</strong>.</li>
                    <li>La cuenta web de <strong>{nombreCuentaDeBaja}</strong> se da de baja y <strong>no se puede recuperar</strong>: esa persona ya no podrá entrar con ella.</li>
                  </Box>
                  <FormControlLabel
                    control={<Checkbox checked={entiendo} onChange={(_e, marcado) => setEntiendo(marcado)} disabled={procesando} />}
                    label={`Entiendo que la cuenta web de ${nombreCuentaDeBaja} se da de baja para siempre`}
                  />
                </Alert>
              ) : null}
            </Stack>
          ) : null}

          {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={cerrar} disabled={procesando}>Cancelar</Button>
        <Button variant="contained" color="warning" onClick={() => void confirmar()} disabled={!puedeConfirmar}>
          {procesando ? 'Fusionando…' : 'Fusionar clientes'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
