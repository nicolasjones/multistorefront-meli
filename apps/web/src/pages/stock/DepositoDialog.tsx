import { type FormEvent, useState } from 'react'
import {
  Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, Stack, TextField,
} from '@mui/material'
import type { Empresa } from '../../hooks/useEmpresas'
import {
  LARGO_MAXIMO_DIRECCION_DEPOSITO, LARGO_MAXIMO_NOMBRE_DEPOSITO, actualizarDeposito, crearDeposito, formularioDepositoVacio, mensajeDeErrorDeposito,
  validarDeposito, type Deposito, type FormularioDeposito,
} from '../../lib/depositos'
import { EstadoError } from '../../components/estados/EstadosPagina'
import { TituloDialogo } from '../../components/base/TituloDialogo'

type Props = {
  // null = «Nuevo depósito de mercadería»; con valor, edición con el mismo formulario.
  deposito: Deposito | null
  empresas: Empresa[]
  errorEmpresas?: boolean
  onCerrar: () => void
  onGuardado: (resultado: { id: string; nombre: string }, esAlta: boolean) => void
}

// Diálogo «Nuevo depósito de mercadería» (F-STK-14, FR-002): Nombre, Dirección y «Pueden vender
// desde acá» (empresas de la organización). Se carga de forma diferida desde la pantalla Depósitos.
// La autoridad de las reglas (nombre único, solo Administrador) es la RPC.
export default function DepositoDialog({ deposito, empresas, errorEmpresas = false, onCerrar, onGuardado }: Props) {
  const [formulario, setFormulario] = useState<FormularioDeposito>(() => formularioDepositoVacio(deposito))
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)

  const esAlta = deposito === null
  const errores = intentoEnvio ? validarDeposito(formulario) : {}

  const cerrar = () => {
    if (!enviando) onCerrar()
  }

  const alternarEmpresa = (empresaId: string) =>
    setFormulario((previo) => ({
      ...previo,
      empresas: previo.empresas.includes(empresaId)
        ? previo.empresas.filter((id) => id !== empresaId)
        : [...previo.empresas, empresaId],
    }))

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
            <FormControl component="fieldset" error={errorEmpresas}>
              <FormLabel component="legend">Pueden vender desde acá</FormLabel>
              <FormGroup>
                {empresas.map((empresa) => (
                  <FormControlLabel
                    key={empresa.id}
                    label={empresa.nombre}
                    control={<Checkbox checked={formulario.empresas.includes(empresa.id)} onChange={() => alternarEmpresa(empresa.id)} />}
                  />
                ))}
              </FormGroup>
              {errorEmpresas ? <FormHelperText>No pudimos cargar las empresas. Cerrá y volvé a abrir el diálogo.</FormHelperText> : null}
              {!errorEmpresas && empresas.length === 0 ? <FormHelperText>La organización todavía no tiene empresas.</FormHelperText> : null}
            </FormControl>
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
