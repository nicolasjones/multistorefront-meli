import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, TextField } from '@mui/material'
import { formatearCuit } from '../../lib/cuit'
import {
  type CampoProveedor,
  type ErroresProveedor,
  type FormularioProveedor,
  type Proveedor,
  FORMULARIO_PROVEEDOR_VACIO,
  actualizarProveedor,
  aFormulario,
  crearProveedor,
  esConflicto,
  esCuitRepetido,
  mensajeDeError,
  MENSAJE_CUIT_REPETIDO,
  validarProveedor,
} from '../../lib/proveedores'
import { EstadoError } from '../estados/EstadosPagina'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // Sin proveedor = alta; con proveedor = edición (carga sus datos y usa su updated_at como bloqueo).
  proveedor?: Proveedor | null
  onCerrar: () => void
  onGuardado: (proveedor: Proveedor) => void
  // Ante un conflicto de edición: recargar la ficha con los datos de la otra persona.
  onRecargar?: () => void
}

const CAMPOS: ReadonlyArray<{ campo: CampoProveedor; etiqueta: string; type?: string; multilinea?: boolean; requerido?: boolean }> = [
  { campo: 'razon_social', etiqueta: 'Razón social', requerido: true },
  { campo: 'cuit', etiqueta: 'CUIT', requerido: true },
  { campo: 'persona_contacto', etiqueta: 'Persona de contacto' },
  { campo: 'correo', etiqueta: 'Correo', type: 'email' },
  { campo: 'telefono', etiqueta: 'Teléfono', type: 'tel' },
  { campo: 'direccion', etiqueta: 'Dirección' },
  { campo: 'observaciones', etiqueta: 'Observaciones', multilinea: true },
]

// Diálogo Nuevo / Editar proveedor (F-PRV-01, FR-007). Campos del prototipo
// Proveedores · Listado / Ficha; las condiciones de compra quedan fuera de alcance
// (spec, Decisiones abiertas 3). La autoridad es la base (CUIT, unicidad, bloqueo
// optimista): acá se valida antes de viajar y se traducen sus errores.
export function ProveedorFormDialog({ open, proveedor = null, onCerrar, onGuardado, onRecargar }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-proveedor-form">
      {/* El formulario se monta al abrir: cada apertura parte de los datos vigentes. */}
      <Formulario proveedor={proveedor} onCerrar={onCerrar} onGuardado={onGuardado} onRecargar={onRecargar} />
    </Dialog>
  )
}

type PropsFormulario = Omit<Props, 'open'>

function Formulario({ proveedor, onCerrar, onGuardado, onRecargar }: PropsFormulario) {
  const edicion = Boolean(proveedor)
  const inicial: FormularioProveedor = proveedor
    ? { ...aFormulario(proveedor), cuit: formatearCuit(proveedor.cuit) }
    : FORMULARIO_PROVEEDOR_VACIO
  const [formulario, setFormulario] = useState<FormularioProveedor>(inicial)
  const [errores, setErrores] = useState<ErroresProveedor>({})
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refs = useRef<Partial<Record<CampoProveedor, HTMLInputElement | HTMLTextAreaElement | null>>>({})

  const cambiar = (campo: CampoProveedor) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormulario((actual) => ({ ...actual, [campo]: event.target.value }))
    if (errores[campo]) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  // El CUIT se muestra con guiones apenas se completa (FR-007); si no es de 11 dígitos queda como se escribió.
  const formatearAlSalir = () => setFormulario((actual) => ({ ...actual, cuit: formatearCuit(actual.cuit) }))

  const enfocarPrimerError = (nuevos: ErroresProveedor) => {
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
    const nuevos = validarProveedor(formulario)
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) {
      enfocarPrimerError(nuevos)
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      const guardado = proveedor
        ? await actualizarProveedor(formulario, { id: proveedor.id, actualizadoEn: proveedor.updated_at })
        : await crearProveedor(formulario)
      onGuardado(guardado)
    } catch (error) {
      if (esCuitRepetido(error)) {
        console.error('CUIT repetido al guardar el proveedor.', error)
        const repetido = { cuit: MENSAJE_CUIT_REPETIDO }
        setErrores(repetido)
        enfocarPrimerError(repetido)
      } else {
        setErrorServidor({
          texto: mensajeDeError(error, 'No pudimos guardar el proveedor. Intentá de nuevo.'),
          conflicto: esConflicto(error),
        })
      }
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-proveedor-form" onCerrar={guardando ? undefined : onCerrar}>
        {edicion ? 'Editar proveedor' : 'Nuevo proveedor'}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <EstadoError
              titulo={errorServidor.conflicto ? 'El proveedor cambió.' : 'No se guardó el proveedor.'}
              descripcion={errorServidor.texto}
              reintentar={errorServidor.conflicto && onRecargar ? onRecargar : undefined}
              etiquetaReintentar="Recargar"
            />
          ) : null}
          {CAMPOS.map(({ campo, etiqueta, type, multilinea, requerido }, indice) => (
            <TextField
              key={campo}
              label={etiqueta}
              type={type}
              value={formulario[campo]}
              onChange={cambiar(campo)}
              onBlur={campo === 'cuit' ? formatearAlSalir : undefined}
              error={Boolean(errores[campo])}
              helperText={errores[campo]}
              required={requerido}
              multiline={multilinea}
              minRows={multilinea ? 3 : undefined}
              autoComplete="off"
              autoFocus={indice === 0}
              inputRef={(el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[campo] = el }}
              fullWidth
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar proveedor'}
        </Button>
      </DialogActions>
    </Box>
  )
}
