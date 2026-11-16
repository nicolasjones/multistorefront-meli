import { type FormEvent, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField,
} from '@mui/material'
import type { Empresa } from '../../hooks/useEmpresas'
import {
  LARGO_MAXIMO_DIRECCION_DEPOSITO, LARGO_MAXIMO_NOMBRE_DEPOSITO, actualizarDeposito, crearDeposito, formularioDepositoVacio, mensajeDeErrorDeposito,
  validarDeposito, type Deposito, type FormularioDeposito,
} from '../../lib/depositos'
import { EstadoError } from '../../components/estados/EstadosPagina'
import { SelectorEmpresas } from '../../components/base/SelectorEmpresas'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Props = {
  // null = «Nuevo depósito de mercadería»; con valor, edición con el mismo formulario.
  deposito: Deposito | null
  empresaPreseleccionada?: string | null
  empresas: Empresa[]
  errorEmpresas?: boolean
  onCerrar: () => void
  onGuardado: (resultado: { id: string; nombre: string }, esAlta: boolean) => void
}

// Diálogo «Nuevo depósito de mercadería» (F-STK-14, FR-002): Nombre, Dirección y «Pueden vender
// desde acá» (empresas de la organización). Se carga de forma diferida desde la pantalla Depósitos.
// La autoridad de las reglas (nombre único, solo Administrador) es la RPC.
export default function DepositoDialog({ deposito, empresaPreseleccionada = null, empresas, errorEmpresas = false, onCerrar, onGuardado }: Props) {
  const [formulario, setFormulario] = useState<FormularioDeposito>(() => formularioDepositoVacio(deposito, empresaPreseleccionada))
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)

  const esAlta = deposito === null
  const errores = intentoEnvio ? validarDeposito(formulario) : {}

  const cerrar = () => {
    if (!enviando) onCerrar()
  }

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enviando) return
    setIntentoEnvio(true)
    if (Object.keys(validarDeposito(formulario)).length > 0) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const resultado = esAlta ? await crearDeposito(formulario) : await actualizarDeposito(deposito.id, formulario)
      onGuardado(resultado, esAlta)
    } catch (error) {
      setErrorEnvio(mensajeDeErrorDeposito(error, 'No pudimos guardar el depósito. Intentá de nuevo.'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-deposito">
      <Box component="form" onSubmit={(evento) => void guardar(evento)} noValidate>
        <TituloDialogo id="titulo-deposito" onCerrar={cerrar}>
          {esAlta ? 'Nuevo depósito de mercadería' : `Editar ${deposito.nombre}`}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorEnvio ? <EstadoError titulo="No pudimos guardar el depósito." descripcion={errorEnvio} /> : null}
            <TextField
              label="Nombre"
              value={formulario.nombre}
              onChange={(evento) => setFormulario((previo) => ({ ...previo, nombre: evento.target.value }))}
              required
              autoFocus
              error={Boolean(errores.nombre)}
              helperText={errores.nombre}
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_NOMBRE_DEPOSITO + 20 } }}
            />
            <TextField
              label="Dirección"
              value={formulario.direccion}
              onChange={(evento) => setFormulario((previo) => ({ ...previo, direccion: evento.target.value }))}
              error={Boolean(errores.direccion)}
              helperText={errores.direccion}
              slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_DIRECCION_DEPOSITO + 20 } }}
            />
            <SelectorEmpresas
              empresas={empresas}
              seleccion={formulario.empresas}
              onCambiar={(seleccion) => setFormulario((previo) => ({ ...previo, empresas: seleccion }))}
              etiqueta="Pueden vender desde acá"
              hayError={errorEmpresas}
              mensajeError="No pudimos cargar las empresas. Cerrá y volvé a abrir el diálogo."
              mensajeVacio="La organización todavía no tiene empresas."
              deshabilitado={enviando}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={enviando}>
            {enviando ? 'Guardando…' : esAlta ? 'Crear depósito' : 'Guardar'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
