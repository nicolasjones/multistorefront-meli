import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import {
  type CampoFicha,
  AVISO_CAMBIO_TIPO,
  type ErroresCliente,
  type FormularioCliente as DatosFormulario,
  MENSAJE_DOCUMENTO_REPETIDO,
  TIPOS_CLIENTE,
  aValores,
  esDocumentoRepetido,
  mensajeDeError,
  validarCliente,
} from '../../lib/clientes'
import type { Empresa } from '../../hooks/useEmpresas'
import { EstadoError } from '../estados/EstadosPagina'
import { SelectorEmpresas } from '../base/SelectorEmpresas'

type Props = {
  inicial: DatosFormulario
  etiquetaGuardar: string
  // Número del cliente cuando se edita (sólo lectura, como en el prototipo).
  numero?: number | null
  // Catálogo de tiendas de la organización para «Habilitado en» (F-CLI-05).
  // Quien no lo pasa (p. ej. una prueba del formulario) no ve tiendas.
  empresas?: Empresa[]
  cargandoEmpresas?: boolean
  errorEmpresas?: boolean
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
  { campo: 'expreso_preferido', etiqueta: 'Expreso preferido', autoComplete: 'off' },
]

// Formulario compartido por el alta y la edición de clientes (FR-001, FR-014).
// Layout en diálogo 700px fiel al prototipo Clientes · Listado (grid 2 cols, cards de tipo,
// número readonly). «Habilitado en» elige las tiendas del cliente (F-CLI-05); las tiendas
// llegan como prop (catálogo de la organización). Cuenta web sigue fuera (épica MSF-450).
export function FormularioCliente({ inicial, etiquetaGuardar, numero, empresas = [], cargandoEmpresas = false, errorEmpresas = false, onGuardar, rutaCancelar }: Props) {
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
    <Box component="form" onSubmit={enviar} noValidate sx={{ maxWidth: 700 }}>
      <Stack spacing={2}>
        {errorServidor ? <EstadoError titulo="No se guardó el cliente." descripcion={errorServidor} /> : null}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField label="Número" value={numero != null ? String(numero) : 'Se asigna solo'} disabled fullWidth />
          <TextField
            label="DNI/CUIT"
            value={formulario.documento}
            onChange={cambiar('documento')}
            error={Boolean(errores.documento)}
            helperText={errores.documento}
            autoComplete="off"
            inputRef={(el: HTMLInputElement | null) => { refs.current.documento = el }}
            fullWidth
          />
        </Box>
        <TextField
          label="Nombre o razón social"
          value={formulario.nombre}
          onChange={cambiar('nombre')}
          error={Boolean(errores.nombre)}
          helperText={errores.nombre}
          required
          autoComplete="off"
          inputRef={(el: HTMLInputElement | null) => { refs.current.nombre = el }}
          fullWidth
        />
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Tipo de cliente</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1 }}>
            {TIPOS_CLIENTE.map(({ valor, etiqueta, explicacion }) => (
              <Box
                key={valor}
                component="button"
                type="button"
                onClick={() => setFormulario((a) => ({ ...a, tipo: valor }))}
                sx={{
                  p: 1.5, border: '1px solid', borderColor: formulario.tipo === valor ? 'primary.main' : 'divider',
                  borderRadius: 2, bgcolor: formulario.tipo === valor ? 'action.selected' : 'background.paper',
                  textAlign: 'left', cursor: 'pointer',
                }}
              >
                <Typography variant="subtitle2">{etiqueta}</Typography>
                <Typography variant="caption" color="text.secondary">{explicacion}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
        <Box>
          <SelectorEmpresas
            empresas={empresas}
            seleccion={formulario.empresas}
            onCambiar={(seleccion) => setFormulario((actual) => ({ ...actual, empresas: seleccion }))}
            etiqueta="Habilitado en"
            cargando={cargandoEmpresas}
            hayError={errorEmpresas}
            mensajeError="No pudimos cargar las tiendas."
            mensajeVacio="La organización todavía no tiene tiendas cargadas."
            ayuda="El cliente es único en la organización. Elegí en qué tiendas puede comprar."
          />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField label="Correo" type="email" value={formulario.correo} onChange={cambiar('correo')} error={Boolean(errores.correo)} helperText={errores.correo} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.correo = el }} fullWidth />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField label="Teléfono" type="tel" value={formulario.telefono} onChange={cambiar('telefono')} error={Boolean(errores.telefono)} helperText={errores.telefono} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.telefono = el }} fullWidth />
            <TextField label="Celular" type="tel" value={formulario.celular} onChange={cambiar('celular')} error={Boolean(errores.celular)} helperText={errores.celular} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.celular = el }} fullWidth />
          </Box>
        </Box>
        <TextField label="Dirección" value={formulario.direccion} onChange={cambiar('direccion')} error={Boolean(errores.direccion)} helperText={errores.direccion} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.direccion = el }} fullWidth />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr 2fr' }, gap: 2 }}>
          <TextField label="Código postal" value={formulario.codigo_postal} onChange={cambiar('codigo_postal')} error={Boolean(errores.codigo_postal)} helperText={errores.codigo_postal} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.codigo_postal = el }} fullWidth />
          <TextField label="Localidad" value={formulario.localidad} onChange={cambiar('localidad')} error={Boolean(errores.localidad)} helperText={errores.localidad} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.localidad = el }} fullWidth />
          <TextField label="Provincia" value={formulario.provincia} onChange={cambiar('provincia')} error={Boolean(errores.provincia)} helperText={errores.provincia} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.provincia = el }} fullWidth />
        </Box>
        <TextField label="Expreso preferido" value={formulario.expreso_preferido} onChange={cambiar('expreso_preferido')} error={Boolean(errores.expreso_preferido)} helperText={errores.expreso_preferido} autoComplete="off" inputRef={(el: HTMLInputElement | null) => { refs.current.expreso_preferido = el }} fullWidth />
        {formulario.tipo !== inicial.tipo ? <Alert severity="info">{AVISO_CAMBIO_TIPO}</Alert> : null}
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
