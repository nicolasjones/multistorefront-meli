import { type FormEvent, useEffect, useState } from 'react'
import { useCreate } from '@refinedev/core'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useGuardarEmpresasDeCliente } from '../../hooks/useEmpresasDeCliente'
import {
  FORMULARIO_CLIENTE_VACIO,
  aValores,
  mensajeDeError,
  validarCliente,
  type ErroresCliente,
} from '../../lib/clientes'
import type { ClienteElegido } from '../../lib/reparaciones'

type Props = { abierto: boolean; onCerrar: () => void; onCreado: (cliente: ClienteElegido) => void }

type Campos = { nombre: string; celular: string; correo: string }
const CAMPOS_VACIOS: Campos = { nombre: '', celular: '', correo: '' }

// Alta rápida de cliente dentro de la reparación (FR-015). No hay una RPC de alta mínima de MSF-180 en `main`:
// se usa el mismo camino que la pantalla Nuevo cliente (recurso `clientes` de Refine, `validarCliente` y
// `aValores` de lib/clientes, y las tiendas con `guardar_empresas_de_cliente`), así que no se duplican sus
// validaciones. Un cliente nuevo arranca habilitado en todas las tiendas, como en esa pantalla.
export function AltaRapidaClienteDialog({ abierto, onCerrar, onCreado }: Props) {
  const [campos, setCampos] = useState<Campos>(CAMPOS_VACIOS)
  const [errores, setErrores] = useState<ErroresCliente>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const { mutateAsync } = useCreate<{ id: string }>()
  const { empresas } = useEmpresas({ habilitado: abierto })
  const { guardar } = useGuardarEmpresasDeCliente()

  useEffect(() => {
    if (!abierto) return
    setCampos(CAMPOS_VACIOS)
    setErrores({})
    setErrorGeneral(null)
  }, [abierto])

  const cerrar = () => {
    if (!guardando) onCerrar()
  }

  const cambiar = (campo: keyof Campos, valor: string) => {
    setCampos((previo) => ({ ...previo, [campo]: valor }))
    setErrores((previos) => ({ ...previos, [campo]: undefined }))
  }

  const crear = async (evento: FormEvent) => {
    evento.preventDefault()
    if (guardando) return
    const formulario = { ...FORMULARIO_CLIENTE_VACIO, ...campos, empresas: empresas.map((empresa) => empresa.id) }
    const encontrados = validarCliente(formulario)
    setErrores(encontrados)
    setErrorGeneral(null)
    if (Object.keys(encontrados).length > 0) return
    setGuardando(true)
    try {
      const { empresas: tiendas, ...datos } = aValores(formulario)
      const { data } = await mutateAsync({ resource: 'clientes', values: datos, successNotification: false })
      // Si falla guardar las tiendas el cliente ya existe: se sigue con él (no se reintenta el alta para no
      // duplicarlo) y se deja el detalle en consola; se pueden reasignar desde su ficha.
      try {
        await guardar(data.id, tiendas)
      } catch (error) {
        console.error('Cliente creado pero no se pudieron guardar sus tiendas', error)
      }
      onCreado({ id: data.id, nombre: formulario.nombre.trim(), contacto: formulario.celular.trim() || formulario.correo.trim() })
    } catch (error) {
      setErrorGeneral(mensajeDeError(error, 'No pudimos crear el cliente. Intentá de nuevo.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-alta-rapida-cliente">
      <Box component="form" onSubmit={(evento) => void crear(evento)} noValidate>
        <TituloDialogo id="titulo-alta-rapida-cliente" onCerrar={cerrar}>Nuevo cliente</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorGeneral ? <Alert severity="error">{errorGeneral}</Alert> : null}
            <TextField
              label="Nombre o razón social"
              value={campos.nombre}
              onChange={(evento) => cambiar('nombre', evento.target.value)}
              required
              autoFocus
              error={Boolean(errores.nombre)}
              helperText={errores.nombre}
            />
            <TextField
              label="Celular"
              value={campos.celular}
              onChange={(evento) => cambiar('celular', evento.target.value)}
              slotProps={{ htmlInput: { inputMode: 'tel' } }}
              error={Boolean(errores.celular)}
              helperText={errores.celular}
            />
            <TextField
              label="Correo"
              value={campos.correo}
              onChange={(evento) => cambiar('correo', evento.target.value)}
              slotProps={{ htmlInput: { inputMode: 'email' } }}
              error={Boolean(errores.correo)}
              helperText={errores.correo}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Creando…' : 'Crear cliente'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
