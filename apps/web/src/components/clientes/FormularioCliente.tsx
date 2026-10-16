import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Stack, TextField } from '@mui/material'
import {
  type CampoFicha,
  type ErroresCliente,
  type FormularioCliente as DatosFormulario,
  MENSAJE_DOCUMENTO_REPETIDO,
  aValores,
  esDocumentoRepetido,
  mensajeDeError,
  validarCliente,
} from '../../lib/clientes'
import { EstadoError } from '../estados/EstadosPagina'

type Props = {
  inicial: DatosFormulario
  etiquetaGuardar: string
  // Rechaza con el error del servidor; el formulario conserva lo escrito.
  onGuardar: (valores: ReturnType<typeof aValores>) => Promise<void>
  rutaCancelar: string
}

const CAMPOS: ReadonlyArray<{ campo: CampoFicha; etiqueta: string; autoComplete?: string; type?: string }> = [
  { campo: 'nombre', etiqueta: 'Nombre o razón social', autoComplete: 'off' },
  { campo: 'documento', etiqueta: 'DNI/CUIT', autoComplete: 'off' },
  { campo: 'correo', etiqueta: 'Correo', autoComplete: 'off', type: 'email' },
  { campo: 'telefono', etiqueta: 'Teléfono', autoComplete: 'off', type: 'tel' },
  { campo: 'celular', etiqueta: 'Celular', autoComplete: 'off', type: 'tel' },
  { campo: 'direccion', etiqueta: 'Dirección', autoComplete: 'off' },
  { campo: 'codigo_postal', etiqueta: 'Código postal', autoComplete: 'off' },
  { campo: 'localidad', etiqueta: 'Localidad', autoComplete: 'off' },
  { campo: 'provincia', etiqueta: 'Provincia', autoComplete: 'off' },
]

// Formulario compartido por el alta y la edición de clientes (FR-001, FR-014).
export function FormularioCliente({ inicial, etiquetaGuardar, onGuardar, rutaCancelar }: Props) {
  const [formulario, setFormulario] = useState<DatosFormulario>(inicial)
  const [errores, setErrores] = useState<ErroresCliente>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refs = useRef<Partial<Record<CampoFicha, HTMLInputElement | null>>>({})

  const cambiar = (campo: CampoFicha) => (event: ChangeEvent<HTMLInputElement>) => {
    setFormulario((actual) => ({ ...actual, [campo]: event.target.value }))
    if (errores[campo]) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  const enfocarPrimerError = (nuevos: ErroresCliente) => {
    const primero = CAMPOS.find(({ campo }) => nuevos[campo])
    if (primero) {
      refs.current[primero.campo]?.focus()
    }
  }

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) {
      return
    }
    setErrorServidor(null)
    const nuevos = validarCliente(formulario)
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) {
      enfocarPrimerError(nuevos)
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      await onGuardar(aValores(formulario))
    } catch (error) {
      if (esDocumentoRepetido(error)) {
        const repetido = { documento: MENSAJE_DOCUMENTO_REPETIDO }
        setErrores(repetido)
        enfocarPrimerError(repetido)
      } else {
        setErrorServidor(mensajeDeError(error, 'No pudimos guardar el cliente.'))
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate sx={{ maxWidth: 560 }}>
      <Stack spacing={2}>
        {errorServidor ? <EstadoError titulo="No se guardó el cliente." descripcion={errorServidor} /> : null}
        {CAMPOS.map(({ campo, etiqueta, autoComplete, type }) => (
          <TextField
            key={campo}
            label={etiqueta}
            type={type}
            value={formulario[campo]}
            onChange={cambiar(campo)}
            error={Boolean(errores[campo])}
            helperText={errores[campo]}
            required={campo === 'nombre'}
            autoComplete={autoComplete}
            inputRef={(elemento: HTMLInputElement | null) => {
              refs.current[campo] = elemento
            }}
            fullWidth
          />
        ))}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button component={RouterLink} to={rutaCancelar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>
            {guardando ? 'Guardando…' : etiquetaGuardar}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
