import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Alert, AlertTitle, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, FormControl, FormHelperText, InputLabel,
  MenuItem, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import {
  LARGO_MAXIMO_NOTA, MENSAJE_MOVIMIENTO_REGISTRADO, TIPOS_MOVIMIENTO, TITULO_STOCK_INSUFICIENTE, avisoStockInsuficiente, fechaDeHoy, formularioMovimientoVacio,
  esStockInsuficiente, mensajeDeErrorMovimiento, motivosDelTipo, stockResultante, validarMovimiento,
  type ErroresMovimiento, type FormularioMovimiento, type MotivoMovimiento, type TipoMovimiento,
} from '../../lib/stock'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { TituloDialogo } from '../../components/base/TituloDialogo'

export type ProductoStock = { id: string; nombre: string; sku: string | null; cantidad: number }

type Props = {
  abierto: boolean
  // Producto preseleccionado cuando se abre desde una fila del listado.
  productoId?: string
  onCerrar: () => void
  onRegistrado: () => void
}

type FilaProductoConStock = {
  id: string
  nombre: string
  sku: string | null
  existencias: { cantidad: number } | { cantidad: number }[] | null
}

const MAX_PRODUCTOS = 500

function cantidadDe(existencias: FilaProductoConStock['existencias']): number {
  const fila = Array.isArray(existencias) ? existencias[0] : existencias
  return fila?.cantidad ?? 0
}

const etiquetaProducto = (producto: ProductoStock) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

// Diálogo «Registrar movimiento de stock» (F-STK-02, FR-009). Se carga de forma
// diferida desde el listado. Muestra el stock resultante antes de confirmar; la
// autoridad de todas las reglas es public.registrar_movimiento_stock.
export default function NuevoMovimientoDialog({ abierto, productoId = '', onCerrar, onRegistrado }: Props) {
  const [formulario, setFormulario] = useState<FormularioMovimiento>(() => formularioMovimientoVacio(productoId))
  const [productos, setProductos] = useState<ProductoStock[]>([])
  const [motivos, setMotivos] = useState<MotivoMovimiento[]>([])
  const [responsable, setResponsable] = useState('')
  const [catalogoTruncado, setCatalogoTruncado] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [intentoEnvio, setIntentoEnvio] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [registrado, setRegistrado] = useState(false)
  const [recarga, setRecarga] = useState(0)

  // El producto preseleccionado cambia con la fila desde la que se abre el diálogo.
  useEffect(() => {
    if (abierto) setFormulario(formularioMovimientoVacio(productoId))
  }, [abierto, productoId])

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setCargando(true)
    setErrorCarga(false)
    const cargar = async () => {
      const [respuestaProductos, respuestaMotivos, sesion] = await Promise.all([
        supabaseClient
          .schema('dominio')
          .from('productos')
          .select('id, nombre, sku, existencias(cantidad)')
          .order('nombre', { ascending: true })
          .order('id', { ascending: true })
          .limit(MAX_PRODUCTOS + 1)
          .returns<FilaProductoConStock[]>(),
        supabaseClient
          .schema('dominio')
          .from('motivos_movimiento')
          .select('id, nombre, aplica_a, activo')
          .eq('activo', true)
          .order('nombre', { ascending: true })
          .returns<MotivoMovimiento[]>(),
        supabaseClient.auth.getUser(),
      ])
      if (respuestaProductos.error) throw respuestaProductos.error
      if (respuestaMotivos.error) throw respuestaMotivos.error
      if (!vigente) return
      const filas = respuestaProductos.data ?? []
      setCatalogoTruncado(filas.length > MAX_PRODUCTOS)
      setProductos(filas.slice(0, MAX_PRODUCTOS).map((fila) => ({
        id: fila.id, nombre: fila.nombre, sku: fila.sku, cantidad: cantidadDe(fila.existencias),
      })))
      setMotivos(respuestaMotivos.data ?? [])
      // Mismo criterio que la RPC para actor_nombre: nombre y apellido, o el email si no hay perfil.
      const usuario = sesion.data.user
      let nombre = ''
      if (usuario) {
        const { data: perfil } = await supabaseClient
          .from('perfiles_usuario')
          .select('nombre, apellido')
          .eq('user_id', usuario.id)
          .maybeSingle<{ nombre: string | null; apellido: string | null }>()
        nombre = [perfil?.nombre, perfil?.apellido].filter(Boolean).join(' ').trim()
      }
      if (!vigente) return
      setResponsable(nombre || usuario?.email || '')
      setCargando(false)
    }
    cargar().catch((error) => {
      console.error('No pudimos preparar el movimiento de stock.', error)
      if (vigente) { setErrorCarga(true); setCargando(false) }
    })
    return () => { vigente = false }
  }, [abierto, recarga])

  const producto = useMemo(() => productos.find((p) => p.id === formulario.producto_id) ?? null, [productos, formulario.producto_id])
  const motivosOfrecidos = useMemo(() => motivosDelTipo(motivos, formulario.tipo), [motivos, formulario.tipo])
  const errores: ErroresMovimiento = intentoEnvio ? validarMovimiento(formulario) : {}
  const resultante = producto ? stockResultante(formulario.tipo, producto.cantidad, formulario.cantidad) : null
  const avisoStock = producto ? avisoStockInsuficiente(formulario.tipo, producto.cantidad, formulario.cantidad) : null

  const cerrar = () => {
    if (enviando) return
    setFormulario(formularioMovimientoVacio(productoId))
    setIntentoEnvio(false)
    setErrorEnvio(null)
    setRegistrado(false)
    onCerrar()
  }

  const cambiarTipo = (tipo: TipoMovimiento) => {
    // Un motivo que no aplica al nuevo tipo se descarta.
    setFormulario((previo) => ({
      ...previo,
      tipo,
      motivo_id: motivosDelTipo(motivos, tipo).some((m) => m.id === previo.motivo_id) ? previo.motivo_id : '',
    }))
  }

  const registrar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enviando || avisoStock) return
    setIntentoEnvio(true)
    if (Object.keys(validarMovimiento(formulario)).length > 0) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const { error } = await supabaseClient.rpc('registrar_movimiento_stock', {
        p_producto: formulario.producto_id,
        p_tipo: formulario.tipo,
        p_cantidad: Number(formulario.cantidad.trim()),
        p_motivo: formulario.motivo_id,
        p_nota: formulario.nota.trim() === '' ? null : formulario.nota.trim(),
        p_fecha: formulario.fecha,
      })
      if (error) throw error
      setRegistrado(true)
      onRegistrado()
    } catch (error) {
      setErrorEnvio(mensajeDeErrorMovimiento(error, 'No pudimos registrar el movimiento. Intentá de nuevo.'))
      // Carrera: otro movimiento cambió el stock. Se vuelve a leer para que el aviso y el reintento usen el valor vigente.
      if (esStockInsuficiente(error)) setRecarga((n) => n + 1)
    } finally {
      setEnviando(false)
    }
  }

  const etiquetaCantidad = formulario.tipo === 'ajuste' ? 'Stock contado' : 'Cantidad'

  return (
    <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-nuevo-movimiento">
      <Box component="form" onSubmit={(evento) => void registrar(evento)} noValidate>
        <TituloDialogo id="titulo-nuevo-movimiento" onCerrar={cerrar}>Registrar movimiento de stock</TituloDialogo>
        <DialogContent>
          {registrado ? (
            <EstadoExito
              titulo={MENSAJE_MOVIMIENTO_REGISTRADO}
              descripcion={producto && resultante !== null ? `${producto.nombre}: stock resultante ${resultante}.` : undefined}
            />
          ) : errorCarga ? (
            <EstadoError descripcion="No pudimos preparar el formulario." reintentar={() => setRecarga((n) => n + 1)} />
          ) : cargando ? (
            <EstadoCargaPagina />
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {errorEnvio ? <EstadoError titulo="No pudimos registrar el movimiento." descripcion={errorEnvio} /> : null}
              <Box>
                <ToggleButtonGroup
                  exclusive
                  fullWidth
                  size="small"
                  color="primary"
                  aria-label="Tipo de movimiento"
                  value={formulario.tipo}
                  onChange={(_, valor: TipoMovimiento | null) => { if (valor) cambiarTipo(valor) }}
                >
                  {TIPOS_MOVIMIENTO.map((tipo) => (
                    <ToggleButton key={tipo.valor} value={tipo.valor}>{tipo.etiqueta}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
              <Autocomplete
                options={productos}
                value={producto}
                getOptionLabel={etiquetaProducto}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_, valor) => setFormulario((previo) => ({ ...previo, producto_id: valor?.id ?? '' }))}
                noOptionsText="No hay productos que coincidan"
                renderInput={(parametros) => (
                  <TextField
                    {...parametros}
                    label="Producto"
                    required
                    error={Boolean(errores.producto_id)}
                    helperText={
                      errores.producto_id
                      ?? (producto ? `Stock actual: ${producto.cantidad}` : undefined)
                      ?? (catalogoTruncado ? `Se muestran los primeros ${MAX_PRODUCTOS} productos por nombre.` : undefined)
                    }
                  />
                )}
              />
              <TextField
                label={etiquetaCantidad}
                value={formulario.cantidad}
                onChange={(evento) => setFormulario((previo) => ({ ...previo, cantidad: evento.target.value }))}
                required
                error={Boolean(errores.cantidad) || Boolean(avisoStock)}
                helperText={errores.cantidad}
                slotProps={{
                  htmlInput: {
                    inputMode: 'numeric',
                    'aria-describedby': avisoStock ? 'aviso-stock-insuficiente' : undefined,
                  },
                }}
              />
              {avisoStock ? (
                <Alert severity="error" id="aviso-stock-insuficiente" role="status">
                  <AlertTitle>{TITULO_STOCK_INSUFICIENTE}</AlertTitle>
                  {avisoStock}
                </Alert>
              ) : producto && resultante !== null ? (
                <Typography variant="body2" role="status">
                  Stock resultante: <strong>{resultante}</strong>
                </Typography>
              ) : null}
              <TextField
                label="Fecha"
                type="date"
                value={formulario.fecha}
                onChange={(evento) => setFormulario((previo) => ({ ...previo, fecha: evento.target.value }))}
                required
                error={Boolean(errores.fecha)}
                helperText={errores.fecha}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: fechaDeHoy() } }}
              />
              <FormControl required error={Boolean(errores.motivo_id)}>
                <InputLabel id="motivo-movimiento">Motivo</InputLabel>
                <Select
                  labelId="motivo-movimiento"
                  label="Motivo"
                  value={formulario.motivo_id}
                  onChange={(evento) => setFormulario((previo) => ({ ...previo, motivo_id: evento.target.value }))}
                >
                  {motivosOfrecidos.map((motivo) => <MenuItem key={motivo.id} value={motivo.id}>{motivo.nombre}</MenuItem>)}
                </Select>
                {errores.motivo_id ? <FormHelperText>{errores.motivo_id}</FormHelperText> : null}
              </FormControl>
              <TextField
                label="Nota (opcional)"
                value={formulario.nota}
                onChange={(evento) => setFormulario((previo) => ({ ...previo, nota: evento.target.value }))}
                multiline
                minRows={2}
                error={Boolean(errores.nota)}
                helperText={errores.nota ?? `${formulario.nota.length}/${LARGO_MAXIMO_NOTA}`}
              />
              <Typography variant="body2" color="text.secondary">
                Responsable: {responsable || '—'} · se registra automáticamente con fecha y hora
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {registrado ? (
            <Button variant="contained" onClick={cerrar}>Cerrar</Button>
          ) : (
            <>
              <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
              <Button type="submit" variant="contained" disabled={enviando || cargando || errorCarga || Boolean(avisoStock)}>
                {enviando ? 'Registrando…' : 'Registrar'}
              </Button>
            </>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  )
}
