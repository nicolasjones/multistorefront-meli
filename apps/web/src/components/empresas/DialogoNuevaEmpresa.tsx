import { type FormEvent, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import type { Empresa } from '../../hooks/useEmpresas'
import { useCrearEmpresa } from '../../hooks/useCrearEmpresa'
import { EstadoError } from '../estados/EstadosPagina'

type Props = {
  abierto: boolean
  empresas: Empresa[]
  onCerrar: () => void
  onCreada: () => void
}

const AYUDA_COPIA = 'Precios, tienda web y reglas de Mercado Libre se copian como punto de partida.'
const SIN_ORIGEN = 'No hay una empresa de la que copiar. Se crea sin configuración.'

// «Nueva empresa» (F-EMP-03). Conserva lo escrito si falla el servidor y
// permite reintentar; el envío queda deshabilitado mientras guarda.
export function DialogoNuevaEmpresa({ abierto, empresas, onCerrar, onCreada }: Props) {
  const [nombre, setNombre] = useState('')
  const [copiarDe, setCopiarDe] = useState('')
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const { crear, guardando } = useCrearEmpresa()
  const haySinOrigen = empresas.length === 0

  const cerrar = () => {
    if (guardando) return
    setNombre(''); setCopiarDe(''); setErrorNombre(null); setErrorServidor(null)
    onCerrar()
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (guardando) return
    setErrorNombre(null); setErrorServidor(null)
    const resultado = await crear(nombre, copiarDe || null)
    if (resultado.ok) {
      setNombre(''); setCopiarDe('')
      onCreada()
      return
    }
    if (resultado.tipo === 'nombre') setErrorNombre(resultado.mensaje)
    else setErrorServidor(resultado.mensaje)
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-nueva-empresa">
      <Box component="form" onSubmit={enviar} noValidate>
        <DialogTitle id="titulo-nueva-empresa">Nueva empresa</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorServidor && <EstadoError titulo="No pudimos crear la empresa." descripcion={errorServidor} />}
            <TextField
              label="Nombre"
              placeholder="Ej.: Tienda Oeste"
              value={nombre}
              onChange={(event) => { setNombre(event.target.value); setErrorNombre(null) }}
              error={Boolean(errorNombre)}
              helperText={errorNombre ?? undefined}
              autoComplete="off"
              autoFocus
              required
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              select
              label="Copiar configuración de"
              value={copiarDe}
              onChange={(event) => setCopiarDe(event.target.value)}
              disabled={haySinOrigen}
              helperText={haySinOrigen ? SIN_ORIGEN : AYUDA_COPIA}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            >
              <option value="">Sin copiar</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>{empresa.nombre}</option>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Creando…' : 'Crear empresa'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
