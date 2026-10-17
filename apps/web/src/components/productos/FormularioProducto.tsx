import { type ChangeEvent, type ComponentProps, type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, MenuItem, Stack, TextField,
} from '@mui/material'
import {
  type CampoProducto,
  AYUDA_SKU,
  type ErroresProducto,
  type FormularioProducto as DatosFormulario,
  AVISO_FALTAN_DATOS,
  MONEDAS,
  PRECIO_EN_PESOS_NO_DISPONIBLE,
  esConflicto,
  hayCambios,
  esSkuRepetido,
  mensajeDeError,
  validarProducto,
} from '../../lib/productos'
import { type CambiosImagenes, type ImagenExistente, SIN_CAMBIOS_IMAGENES, hayCambiosImagenes } from '../../lib/productoImagenes'
import { EstadoError } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'
import { ImagenesProducto } from './ImagenesProducto'

type Props = {
  inicial: DatosFormulario
  // Imágenes ya guardadas del producto (edición); en el alta no hay.
  imagenesExistentes?: readonly ImagenExistente[]
  // Costo visible y editable solo con edición en Rentabilidad (FR-003); la base lo exige igual.
  conCosto: boolean
  // El costo se ve con lectura en Rentabilidad pero solo se edita con edición (por defecto, igual a conCosto).
  costoEditable?: boolean
  etiquetaGuardar: string
  // Rechaza con el error del servidor; el formulario conserva lo escrito.
  onGuardar: (formulario: DatosFormulario, imagenes: CambiosImagenes) => Promise<void>
  rutaCancelar: string
  // Solo lectura (FR-011): ficha visible, sin acción de guardar.
  soloLectura?: boolean
  // Ante un conflicto de edición concurrente (40001) se ofrece recargar el producto.
  onRecargar?: () => void
}

const ETIQUETAS: Readonly<Record<CampoProducto, string>> = {
  nombre: 'Nombre',
  descripcion: 'Descripción',
  sku: 'SKU',
  compatible_con: 'Compatible con',
  moneda: 'Moneda',
  precio_lista: 'Precio de lista (sin IVA)',
  costo: 'Costo',
}

// Formulario compartido por el alta y (F-CAT-04) la edición de productos
// (FR-001, FR-003, FR-004). Sin stock inicial (FR-002).
const AYUDA_COSTO = 'Si lo dejás vacío se conserva el costo actual: todavía no se puede quitar un costo ya cargado.'

export function FormularioProducto({ inicial, imagenesExistentes = [], conCosto, costoEditable = conCosto, etiquetaGuardar, onGuardar, rutaCancelar, soloLectura = false, onRecargar }: Props) {
  const navigate = useNavigate()
  const [formulario, setFormulario] = useState<DatosFormulario>(inicial)
  const [errores, setErrores] = useState<ErroresProducto>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [errorSku, setErrorSku] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [conflicto, setConflicto] = useState(false)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refs = useRef<Partial<Record<CampoProducto, HTMLInputElement | null>>>({})
  const [imagenes, setImagenes] = useState<CambiosImagenes>(SIN_CAMBIOS_IMAGENES)
  const sucio = hayCambios(formulario, inicial) || hayCambiosImagenes(imagenes)

  // «Sale» por cierre o recarga de la pestaña: el navegador pide confirmar.
  useEffect(() => {
    if (!sucio) {
      return undefined
    }
    const avisar = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sucio])

  const cambiar = (campo: CampoProducto) => (event: ChangeEvent<HTMLInputElement>) => {
    setFormulario((actual) => ({ ...actual, [campo]: event.target.value }))
    if (campo === 'sku') {
      setErrorSku(null)
    }
    if (errores[campo]) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  const camposConError = (Object.keys(errores) as CampoProducto[]).filter((campo) => errores[campo])

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) {
      return
    }
    setErrorServidor(null)
    setErrorSku(null)
    setConflicto(false)
    const nuevos = validarProducto(formulario, { conCosto })
    setErrores(nuevos)
    const primero = (Object.keys(nuevos) as CampoProducto[])[0]
    if (primero) {
      refs.current[primero]?.focus()
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      await onGuardar(formulario, imagenes)
    } catch (error) {
      const mensaje = mensajeDeError(error, 'No pudimos guardar el producto.')
      if (esSkuRepetido(error)) {
        setErrorSku(mensaje)
        refs.current.sku?.focus()
      } else {
        setErrorServidor(mensaje)
      }
      setConflicto(esConflicto(error))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const cancelar = () => {
    if (sucio) {
      setConfirmandoDescarte(true)
    } else {
      navigate(rutaCancelar)
    }
  }

  const campoTexto = (campo: CampoProducto, extra: Partial<ComponentProps<typeof TextField>> = {}) => (
    <TextField
      label={ETIQUETAS[campo]}
      value={formulario[campo]}
      onChange={cambiar(campo)}
      error={Boolean(errores[campo])}
      helperText={errores[campo] ?? extra.helperText}
      inputRef={(elemento: HTMLInputElement | null) => {
        refs.current[campo] = elemento
      }}
      autoComplete="off"
      fullWidth
      disabled={soloLectura}
      {...extra}
    />
  )

  return (
    <Box component="form" onSubmit={enviar} noValidate sx={{ maxWidth: 560 }}>
      <Stack spacing={2}>
        {camposConError.length > 0 ? (
          <Alert severity="warning">
            <strong>{AVISO_FALTAN_DATOS}</strong>
            {': '}
            {camposConError.map((campo) => ETIQUETAS[campo]).join(', ')}
          </Alert>
        ) : null}
        {errorServidor ? (
          <EstadoError
            titulo="No se guardó el producto."
            descripcion={conflicto && onRecargar ? `${errorServidor} Al recargar se descarta lo que escribiste.` : errorServidor}
            reintentar={conflicto && onRecargar ? onRecargar : undefined}
            etiquetaReintentar="Recargar producto"
          />
        ) : null}
        {campoTexto('nombre', { required: true })}
        {campoTexto('descripcion', { multiline: true, minRows: 3 })}
        {campoTexto('sku', { helperText: errorSku ?? AYUDA_SKU, error: Boolean(errorSku) })}
        {campoTexto('compatible_con', { helperText: 'Separá los valores con comas, por ejemplo: PS5, Xbox' })}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label={ETIQUETAS.moneda}
            value={formulario.moneda}
            onChange={(event) => setFormulario((actual) => ({ ...actual, moneda: event.target.value as DatosFormulario['moneda'] }))}
            disabled={soloLectura}
            fullWidth
          >
            {MONEDAS.map(({ valor, etiqueta }) => (
              <MenuItem key={valor} value={valor}>{etiqueta}</MenuItem>
            ))}
          </TextField>
          {campoTexto('precio_lista', { required: true, slotProps: { htmlInput: { inputMode: 'decimal' } } })}
        </Stack>
        <TextField
          label="Precio en pesos"
          value={PRECIO_EN_PESOS_NO_DISPONIBLE}
          disabled
          helperText="Se calcula cuando Precios esté disponible."
          fullWidth
        />
        {conCosto ? campoTexto('costo', { disabled: soloLectura || !costoEditable, helperText: costoEditable && !soloLectura ? AYUDA_COSTO : undefined, slotProps: { htmlInput: { inputMode: 'decimal' } } }) : null}
        <ImagenesProducto
          existentes={imagenesExistentes}
          cambios={imagenes}
          onCambiar={setImagenes}
          soloLectura={soloLectura}
          deshabilitado={guardando}
        />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={cancelar} disabled={guardando}>{soloLectura ? 'Volver' : 'Cancelar'}</Button>
          {soloLectura ? null : (
            <Button type="submit" variant="contained" disabled={guardando}>
              {guardando ? 'Guardando…' : etiquetaGuardar}
            </Button>
          )}
        </Stack>
      </Stack>

      <Dialog open={confirmandoDescarte} onClose={() => setConfirmandoDescarte(false)} aria-labelledby="descartar-titulo">
        <TituloDialogo id="descartar-titulo" onCerrar={() => setConfirmandoDescarte(false)}>Descartar cambios</TituloDialogo>
        <DialogContent>
          <DialogContentText>Tenés datos sin guardar. Si salís ahora, se pierden.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmandoDescarte(false)} autoFocus>Seguir editando</Button>
          <Button color="error" onClick={() => navigate(rutaCancelar)}>Descartar cambios</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
