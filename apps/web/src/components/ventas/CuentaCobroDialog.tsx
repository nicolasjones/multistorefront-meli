import { type ChangeEvent, type FormEvent, type MutableRefObject, useRef, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, FormControlLabel, Stack, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useEmpresas } from '../../hooks/useEmpresas'
import { formatearCuit } from '../../lib/cuit'
import {
  type CampoCuentaCobro,
  type CuentaCobro,
  type ErroresCuentaCobro,
  type FormularioCuentaCobro,
  FORMULARIO_CUENTA_COBRO_VACIO,
  MONEDAS,
  TIPOS_CUENTA,
  aFormulario,
  actualizarCuentaCobro,
  crearCuentaCobro,
  esConflicto,
  mensajeDeError,
  validarCuentaCobro,
} from '../../lib/ventas/cuentasCobro'
import { EstadoError } from '../estados/EstadosPagina'
import { SelectorEmpresas } from '../base/SelectorEmpresas'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  // Sin cuenta = alta; con cuenta = edición (carga sus datos y usa su updated_at como bloqueo).
  cuenta?: CuentaCobro | null
  onCerrar: () => void
  onGuardado: (resultado: { alta: boolean; nombre: string }) => void
  // Ante un conflicto de edición: volver a leer la lista con los datos de la otra persona.
  onRecargar?: () => void
}

type CampoTexto = { campo: CampoCuentaCobro; etiqueta: string; requerido?: boolean; multilinea?: boolean; type?: string }

const NOTA_ACTIVA = 'Se ofrece al cargar un comprobante'
const NOTA_NO_USAR = 'No usar: no se ofrece, conserva historial'

// Diálogo Nueva/Editar cuenta de cobro (F-VTA-03, FR-015). Campos del prototipo CuentasCobro.dc.html. La
// autoridad es la base (CBU, CUIT, bloqueo optimista, solo Administrador): acá se valida antes de viajar y se
// traducen sus errores.
export function CuentaCobroDialog({ open, cuenta = null, onCerrar, onGuardado, onRecargar }: Props) {
  // Compartido con el formulario: mientras hay un guardado en vuelo, Esc y clic afuera no cierran.
  const enVuelo = useRef(false)
  const cerrarSiLibre = () => { if (!enVuelo.current) onCerrar() }
  return (
    <Dialog open={open} onClose={cerrarSiLibre} fullWidth maxWidth="sm" aria-labelledby="titulo-cuenta-cobro">
      {/* El formulario se monta al abrir: cada apertura parte de los datos vigentes. */}
      <Formulario cuenta={cuenta} enVuelo={enVuelo} onCerrar={onCerrar} onGuardado={onGuardado} onRecargar={onRecargar} />
    </Dialog>
  )
}

type PropsFormulario = Omit<Props, 'open'> & { enVuelo: MutableRefObject<boolean> }

function Formulario({ cuenta, enVuelo, onCerrar, onGuardado, onRecargar }: PropsFormulario) {
  const alta = !cuenta
  const inicial: FormularioCuentaCobro = cuenta
    ? { ...aFormulario(cuenta), cuit: formatearCuit(cuenta.cuit) }
    : FORMULARIO_CUENTA_COBRO_VACIO
  const [formulario, setFormulario] = useState<FormularioCuentaCobro>(inicial)
  const [errores, setErrores] = useState<ErroresCuentaCobro>({})
  const [errorServidor, setErrorServidor] = useState<{ texto: string; conflicto: boolean } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const { empresas, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresas()
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref (del padre) lo frena.
  const refs = useRef<Partial<Record<CampoCuentaCobro, HTMLInputElement | HTMLTextAreaElement | null>>>({})

  const cambiar = (campo: CampoCuentaCobro) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormulario((actual) => ({ ...actual, [campo]: event.target.value }))
    if (errores[campo]) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  // El CUIT se muestra con guiones apenas se completa; si no es de 11 dígitos queda como se escribió.
  const formatearAlSalir = () => setFormulario((actual) => ({ ...actual, cuit: formatearCuit(actual.cuit) }))

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const nuevos = validarCuentaCobro(formulario)
    setErrores(nuevos)
    const primero = CAMPOS_EN_ORDEN.find((campo) => nuevos[campo])
    if (primero) {
      refs.current[primero]?.focus()
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      if (cuenta) {
        await actualizarCuentaCobro(formulario, { id: cuenta.id, actualizadoEn: cuenta.updated_at })
      } else {
        await crearCuentaCobro(formulario)
      }
      onGuardado({ alta, nombre: formulario.nombre.trim() })
    } catch (error) {
      setErrorServidor({
        texto: mensajeDeError(error, 'No pudimos guardar la cuenta de cobro. Intentá de nuevo.'),
        conflicto: esConflicto(error),
      })
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const campoTexto = ({ campo, etiqueta, requerido, multilinea, type }: CampoTexto, autoFocus = false) => (
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
      minRows={multilinea ? 2 : undefined}
      autoComplete="off"
      autoFocus={autoFocus}
      inputRef={(el: HTMLInputElement | HTMLTextAreaElement | null) => { refs.current[campo] = el }}
      fullWidth
    />
  )

  return (
    <Box component="form" onSubmit={enviar} noValidate>
      <TituloDialogo id="titulo-cuenta-cobro" onCerrar={guardando ? undefined : onCerrar}>
        Cuenta de cobro
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorServidor ? (
            <EstadoError
              titulo={errorServidor.conflicto ? 'La cuenta cambió.' : 'No se guardó la cuenta.'}
              descripcion={errorServidor.texto}
              reintentar={errorServidor.conflicto && onRecargar ? onRecargar : undefined}
              etiquetaReintentar="Recargar"
            />
          ) : null}
          {campoTexto({ campo: 'nombre', etiqueta: 'Nombre de la cuenta', requerido: true }, true)}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {campoTexto({ campo: 'titular', etiqueta: 'Titular', requerido: true })}
            {campoTexto({ campo: 'cuit', etiqueta: 'CUIT del titular', requerido: true })}
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {campoTexto({ campo: 'banco', etiqueta: 'Banco' })}
            {campoTexto({ campo: 'alias', etiqueta: 'Alias' })}
          </Stack>
          {campoTexto({ campo: 'cbu', etiqueta: 'CBU / CVU', requerido: true })}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <Typography id="etiqueta-tipo-cuenta" variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>Tipo de cuenta</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                aria-labelledby="etiqueta-tipo-cuenta"
                value={formulario.tipo}
                onChange={(_, tipo: FormularioCuentaCobro['tipo'] | null) => {
                  if (tipo !== null) setFormulario((actual) => ({ ...actual, tipo }))
                }}
                sx={{ flexWrap: 'wrap' }}
              >
                {TIPOS_CUENTA.map(({ valor, etiqueta }) => <ToggleButton key={valor} value={valor}>{etiqueta}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography id="etiqueta-moneda" variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>Moneda</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                aria-labelledby="etiqueta-moneda"
                value={formulario.moneda}
                onChange={(_, moneda: FormularioCuentaCobro['moneda'] | null) => {
                  if (moneda !== null) setFormulario((actual) => ({ ...actual, moneda }))
                }}
              >
                {MONEDAS.map((moneda) => <ToggleButton key={moneda} value={moneda}>{moneda}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
            <Box sx={{ flex: 1 }}>
              {campoTexto({ campo: 'orden', etiqueta: 'Orden', type: 'number' })}
            </Box>
            <Box sx={{ flex: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formulario.activa}
                    onChange={(_, activa) => setFormulario((actual) => ({ ...actual, activa }))}
                  />
                }
                label="Activa"
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {formulario.activa ? NOTA_ACTIVA : NOTA_NO_USAR}
              </Typography>
            </Box>
          </Stack>
          {campoTexto({ campo: 'notas', etiqueta: 'Notas internas', multilinea: true })}
          <SelectorEmpresas
            empresas={empresas}
            seleccion={formulario.empresaIds}
            onCambiar={(empresaIds) => setFormulario((actual) => ({ ...actual, empresaIds }))}
            etiqueta="Disponible en"
            cargando={cargandoEmpresas}
            hayError={errorEmpresas}
            mensajeError="No pudimos cargar las tiendas."
            mensajeVacio="La organización todavía no tiene tiendas cargadas."
            deshabilitado={guardando}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cuenta'}
        </Button>
      </DialogActions>
    </Box>
  )
}

// Orden visual de los campos: el primer error recibe el foco.
const CAMPOS_EN_ORDEN: CampoCuentaCobro[] = ['nombre', 'titular', 'cuit', 'banco', 'alias', 'cbu', 'orden', 'notas']
