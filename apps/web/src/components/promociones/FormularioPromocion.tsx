import { useRef, useState, type FormEvent } from 'react'
import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogContentText, Stack, TextField } from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import {
  NOTA_PRECIO_SIN_IVA,
  aFechaHoraLocal,
  mensajeErrorPromocion,
  validarPromocion,
  type DatosPromocion,
  type ErroresPromocion,
  type Promocion,
  type ProductoPromocionable,
} from '../../lib/promociones'

type PropsFormulario = {
  // null = alta; con una promoción, edición (el producto y la empresa no se cambian).
  promocion: Promocion | null
  empresaId: string
  empresaNombre: string
  productos: ProductoPromocionable[]
  onCancelar: () => void
  // Rechaza con el error de la base; el diálogo queda abierto para reintentar.
  onGuardar: (datos: DatosPromocion) => Promise<void>
}

const etiquetaProducto = (producto: ProductoPromocionable) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

// Diálogo «Nueva / Editar promoción» (F-PRE-11, FR-016). Una promoción es de UNA empresa: la de la barra
// superior en el alta y la propia de la promoción al editar; el diálogo nunca ofrece elegir otra (Principio
// VIII). El precio es fijo en pesos y se carga sin IVA. La base impide solapes y valida permisos; acá se
// avisa antes de enviar y se muestra el error si la base lo rechaza.
export function FormularioPromocion({ promocion, empresaId, empresaNombre, productos, onCancelar, onGuardar }: PropsFormulario) {
  const editando = promocion !== null
  const [producto, setProducto] = useState<ProductoPromocionable | null>(
    () => (promocion ? productos.find((p) => p.id === promocion.productoId) ?? { id: promocion.productoId, nombre: promocion.productoNombre, sku: promocion.productoSku } : null),
  )
  const [precio, setPrecio] = useState(() => (promocion ? String(promocion.precioPromocional).replace('.', ',') : ''))
  const [desde, setDesde] = useState(() => (promocion ? aFechaHoraLocal(promocion.desde) : ''))
  const [hasta, setHasta] = useState(() => (promocion ? aFechaHoraLocal(promocion.hasta) : ''))
  const [errores, setErrores] = useState<ErroresPromocion>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const datos: DatosPromocion = {
      id: promocion?.id ?? null,
      empresaId,
      productoId: producto?.id ?? '',
      precioTexto: precio,
      desdeTexto: desde,
      hastaTexto: hasta,
      actualizadoEn: promocion?.actualizadoEn ?? null,
    }
    const invalidos = validarPromocion(datos)
    setErrores(invalidos)
    if (Object.keys(invalidos).length > 0) return
    enVuelo.current = true
    setGuardando(true)
    try {
      await onGuardar(datos)
    } catch (error) {
      console.error('No pudimos guardar la promoción.', error)
      setErrorServidor(mensajeErrorPromocion(error, 'No pudimos guardar la promoción. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCancelar} fullWidth maxWidth="sm" aria-labelledby="promocion-titulo">
      <TituloDialogo id="promocion-titulo" onCerrar={guardando ? undefined : onCancelar}>
        {editando ? 'Editar promoción' : 'Nueva promoción'}
      </TituloDialogo>
      <form onSubmit={enviar} noValidate>
        <DialogContent>
          <Stack spacing={2}>
            {errorServidor ? <Alert severity="error">{errorServidor}</Alert> : null}
            <TextField label="Empresa" value={empresaNombre} disabled fullWidth />
            <Autocomplete
              options={productos}
              value={producto}
              disabled={editando}
              getOptionLabel={etiquetaProducto}
              isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
              onChange={(_evento, nuevo) => {
                setProducto(nuevo)
                setErrores((previos) => ({ ...previos, producto: undefined }))
              }}
              noOptionsText="No hay productos que coincidan"
              renderInput={(params) => (
                <TextField {...params} label="Producto" required error={Boolean(errores.producto)} helperText={errores.producto} autoFocus={!editando} />
              )}
            />
            <TextField
              label="Precio promocional (sin IVA)"
              value={precio}
              onChange={(evento) => {
                setPrecio(evento.target.value)
                if (errores.precio) setErrores((previos) => ({ ...previos, precio: undefined }))
              }}
              error={Boolean(errores.precio)}
              helperText={errores.precio ?? NOTA_PRECIO_SIN_IVA}
              required
              autoComplete="off"
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField
              label="Desde"
              type="datetime-local"
              value={desde}
              onChange={(evento) => {
                setDesde(evento.target.value)
                if (errores.desde) setErrores((previos) => ({ ...previos, desde: undefined }))
              }}
              error={Boolean(errores.desde)}
              helperText={errores.desde}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Hasta"
              type="datetime-local"
              value={hasta}
              onChange={(evento) => {
                setHasta(evento.target.value)
                if (errores.hasta) setErrores((previos) => ({ ...previos, hasta: undefined }))
              }}
              error={Boolean(errores.hasta)}
              helperText={errores.hasta ?? 'Rige hasta ese momento, sin incluirlo.'}
              required
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancelar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

type PropsAnular = {
  promocion: Promocion
  onCancelar: () => void
  // Rechaza con el error de la base; el diálogo queda abierto para reintentar.
  onConfirmar: () => Promise<void>
}

// Confirmación de «Anular»: una promoción anulada deja de regir y no se puede reactivar.
export function AnularPromocionDialogo({ promocion, onCancelar, onConfirmar }: PropsAnular) {
  const [anulando, setAnulando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enVuelo = useRef(false)

  const confirmar = async () => {
    if (enVuelo.current) return
    enVuelo.current = true
    setAnulando(true)
    setError(null)
    try {
      await onConfirmar()
    } catch (falla) {
      console.error('No pudimos anular la promoción.', falla)
      setError(mensajeErrorPromocion(falla, 'No pudimos anular la promoción. Probá de nuevo.'))
    } finally {
      enVuelo.current = false
      setAnulando(false)
    }
  }

  return (
    <Dialog open onClose={anulando ? undefined : onCancelar} fullWidth maxWidth="xs" aria-labelledby="anular-promocion-titulo">
      <TituloDialogo id="anular-promocion-titulo" onCerrar={anulando ? undefined : onCancelar}>Anular promoción</TituloDialogo>
      <DialogContent>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <DialogContentText>
            {`¿Anular la promoción de «${promocion.productoNombre}» en ${promocion.empresaNombre}? Deja de regir de inmediato y no se puede reactivar: para volver a ofrecerla, creá otra.`}
          </DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancelar} disabled={anulando}>Cancelar</Button>
        <Button color="error" variant="contained" onClick={() => void confirmar()} disabled={anulando}>{anulando ? 'Anulando…' : 'Anular promoción'}</Button>
      </DialogActions>
    </Dialog>
  )
}
