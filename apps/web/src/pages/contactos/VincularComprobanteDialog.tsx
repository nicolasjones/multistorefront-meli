import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { AVISO_CAMBIO_EMPRESA, useEmpresaActivaCambio } from '../../hooks/useContactos'
import { mensajeDeError, vincularComprobante } from '../../lib/contactos'
import { FILTROS_VACIOS, listarComprobantes } from '../../lib/ventasComprobantes'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Props = {
  contactoId: string
  empresaId: string
  onCerrar: (aviso?: string) => void
  onVinculado: () => void
}

type Resultado = { id: string; numero: string; fecha: string; total: number }

// «Vincular comprobante» (F-CON-05, FR-007): se busca por número entre los comprobantes de la empresa del
// contacto y se vincula uno. El vínculo es manual porque el alta de ventas no pide un contacto.
export function VincularComprobanteDialog({ contactoId, empresaId, onCerrar, onVinculado }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enVuelo = useRef(false)
  const cambioEmpresa = useEmpresaActivaCambio()

  useEffect(() => {
    if (cambioEmpresa) onCerrar(AVISO_CAMBIO_EMPRESA)
  }, [cambioEmpresa, onCerrar])

  const buscar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    enVuelo.current = true
    setBuscando(true)
    setError(null)
    try {
      const pagina = await listarComprobantes({ ...FILTROS_VACIOS, busqueda, empresaId }, 1, 10)
      setResultados(pagina.comprobantes.map((c) => ({ id: c.id, numero: c.numero, fecha: c.fecha, total: c.total })))
    } catch (e) {
      console.error('No se pudieron buscar comprobantes', e instanceof Error ? e.message : e)
      setError('No pudimos buscar comprobantes. Probá de nuevo o revisá tu acceso a Ventas.')
    } finally {
      enVuelo.current = false
      setBuscando(false)
    }
  }

  const vincular = async (comprobanteId: string) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setBuscando(true)
    setError(null)
    try {
      await vincularComprobante(comprobanteId, contactoId)
      onVinculado()
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos vincular el comprobante. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setBuscando(false)
    }
  }

  return (
    <Dialog open onClose={() => onCerrar()} fullWidth maxWidth="sm" aria-labelledby="titulo-vincular-comprobante">
      <TituloDialogo id="titulo-vincular-comprobante" onCerrar={() => onCerrar()}>Vincular comprobante</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <form onSubmit={(evento) => void buscar(evento)}>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Número o cliente"
                size="small"
                fullWidth
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
              />
              <Button type="submit" variant="outlined" disabled={buscando}>Buscar</Button>
            </Stack>
          </form>
          {resultados !== null && resultados.length === 0 ? (
            <Typography variant="s">No encontramos comprobantes de esta empresa con ese dato.</Typography>
          ) : null}
          {resultados !== null && resultados.length > 0 ? (
            <List dense aria-label="Comprobantes encontrados">
              {resultados.map((c) => (
                <ListItem
                  key={c.id}
                  secondaryAction={<Button size="small" onClick={() => void vincular(c.id)} disabled={buscando}>Vincular</Button>}
                >
                  <ListItemText primary={c.numero} secondary={`${c.fecha} · $ ${c.total.toLocaleString('es-AR')}`} />
                </ListItem>
              ))}
            </List>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onCerrar()}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
