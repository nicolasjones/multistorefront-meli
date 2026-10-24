import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { supabaseClient } from '../../lib/supabase'
import { generarClaveIdempotencia } from '../../lib/ingresos'
import {
  LARGO_MAXIMO_PROVEEDOR, MAXIMO_LINEAS_LOTE, formularioLoteVacio, hayErroresLote, lineaLoteVacia,
  lineasParaRpcLote, mensajeDeErrorLote, validarLote, type ErroresLote, type FormularioLote, type LineaLote,
} from '../../lib/lotes'

type ProductoOpcion = { id: string; nombre: string; sku: string | null }
type MotivoOpcion = { id: string; nombre: string; aplica_a: string[] }

const MAXIMO_OPCIONES = 500
const etiquetaProducto = (producto: ProductoOpcion) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

type Props = {
  onRegistrado: (numero: number) => void
}

// Formulario «Carga en lote» (F-STK-10, FR-001/FR-002/FR-008). No calcula stock: la RPC atómica
// crea el lote y una entrada por línea. La clave de idempotencia se mantiene mientras el envío
// no tenga éxito, así un reintento o un doble clic devuelve el mismo lote sin mover stock otra vez.
export function LoteStockForm({ onRegistrado }: Props) {
  const [productos, setProductos] = useState<ProductoOpcion[]>([])
  const [motivos, setMotivos] = useState<MotivoOpcion[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCatalogos, setErrorCatalogos] = useState(false)
  const [formulario, setFormulario] = useState<FormularioLote>(() => formularioLoteVacio())
  const [intento, setIntento] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [exito, setExito] = useState<number | null>(null)
  const [clave, setClave] = useState(generarClaveIdempotencia)
  const enCurso = useRef(false)

  useEffect(() => {
    let vigente = true
    void (async () => {
      const [respuestaProductos, respuestaMotivos] = await Promise.all([
        supabaseClient.schema('dominio').from('productos').select('id, nombre, sku')
          .eq('activo', true).order('nombre', { ascending: true }).limit(MAXIMO_OPCIONES).returns<ProductoOpcion[]>(),
        supabaseClient.schema('dominio').from('motivos_movimiento').select('id, nombre, aplica_a')
          .eq('activo', true).order('nombre', { ascending: true }).returns<MotivoOpcion[]>(),
      ])
      if (!vigente) return
      if (respuestaProductos.error || respuestaMotivos.error) {
        console.error('No pudimos preparar la carga en lote.', respuestaProductos.error ?? respuestaMotivos.error)
        setErrorCatalogos(true)
        setCargando(false)
        return
      }
      const paraEntradas = (respuestaMotivos.data ?? []).filter((motivo) => motivo.aplica_a.includes('entrada'))
      setProductos(respuestaProductos.data ?? [])
      setMotivos(paraEntradas)
      const sugerido = paraEntradas.find((motivo) => motivo.nombre === 'Compra a proveedor') ?? paraEntradas[0]
      if (sugerido) setFormulario((previo) => (previo.motivo_id === '' ? { ...previo, motivo_id: sugerido.id } : previo))
      setCargando(false)
    })()
    return () => { vigente = false }
  }, [])

  const errores: ErroresLote = intento ? validarLote(formulario) : {}

  const unidades = useMemo(
    () => formulario.lineas.reduce((total, linea) => total + (Number(linea.cantidad) || 0), 0),
    [formulario.lineas],
  )

  const cambiar = <C extends keyof FormularioLote>(campo: C, valor: FormularioLote[C]) => {
    setExito(null)
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
  }

  const cambiarLinea = (indice: number, campo: keyof LineaLote, valor: string) => {
    setExito(null)
    setFormulario((previo) => ({
      ...previo,
      lineas: previo.lineas.map((linea, i) => (i === indice ? { ...linea, [campo]: valor } : linea)),
    }))
  }

  const confirmar = async (evento: FormEvent) => {
    evento.preventDefault()
    // Guarda síncrona: el estado `enviando` llega tarde para un doble clic.
    if (enCurso.current) return
    setIntento(true)
    setErrorEnvio(null)
    if (hayErroresLote(validarLote(formulario))) return

    enCurso.current = true
    setEnviando(true)
    try {
      const { data, error } = await supabaseClient.rpc('registrar_lote_stock', {
        p_lineas: lineasParaRpcLote(formulario.lineas),
        p_motivo: formulario.motivo_id,
        p_proveedor: formulario.proveedor.trim() === '' ? null : formulario.proveedor.trim(),
        p_fecha: formulario.fecha,
        p_clave: clave,
      })
      if (error) throw error
      const numero = Number((data as { lote?: { numero?: number } } | null)?.lote?.numero)
      setExito(numero)
      setFormulario(formularioLoteVacio(formulario.motivo_id))
      setIntento(false)
      setClave(generarClaveIdempotencia())
      onRegistrado(numero)
    } catch (error) {
      setErrorEnvio(mensajeDeErrorLote(error, 'No pudimos registrar el lote. Intentá de nuevo.'))
    } finally {
      enCurso.current = false
      setEnviando(false)
    }
  }

  return (
    <Box component="form" onSubmit={(evento) => void confirmar(evento)} noValidate aria-label="Carga en lote">
      <Stack spacing={2}>
        <Typography variant="h3" component="h2">Nuevo lote</Typography>

        {errorCatalogos ? <Alert severity="error">No pudimos cargar productos o motivos. Recargá la página para reintentar.</Alert> : null}
        {errorEnvio ? <Alert severity="error">{errorEnvio}</Alert> : null}
        {exito !== null ? <Alert severity="success" role="status">Lote {exito} registrado</Alert> : null}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
          <TextField
            size="small"
            label="Proveedor"
            value={formulario.proveedor}
            onChange={(evento) => cambiar('proveedor', evento.target.value)}
            error={Boolean(errores.proveedor)}
            helperText={errores.proveedor ?? 'Opcional · texto libre'}
            slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_PROVEEDOR + 20 } }}
            sx={{ minWidth: { xs: '100%', md: 260 }, flex: 1 }}
          />
          <TextField
            size="small"
            type="date"
            label="Fecha"
            value={formulario.fecha}
            onChange={(evento) => cambiar('fecha', evento.target.value)}
            error={Boolean(errores.fecha)}
            helperText={errores.fecha}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: { xs: '100%', md: 170 } }}
          />
          <TextField
            select
            size="small"
            label="Motivo"
            value={formulario.motivo_id}
            onChange={(evento) => cambiar('motivo_id', evento.target.value)}
            error={Boolean(errores.motivo_id)}
            helperText={errores.motivo_id}
            sx={{ minWidth: { xs: '100%', md: 230 } }}
          >
            {motivos.map((motivo) => <MenuItem key={motivo.id} value={motivo.id}>{motivo.nombre}</MenuItem>)}
          </TextField>
        </Stack>

        <Box>
          <Stack spacing={1}>
            {formulario.lineas.map((linea, indice) => {
              const producto = productos.find((opcion) => opcion.id === linea.producto_id) ?? null
              const erroresLinea = errores.porLinea?.[indice] ?? {}
              return (
                <Stack key={indice} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'flex-start' }}>
                  <Autocomplete
                    size="small"
                    sx={{ flex: 2, minWidth: { xs: '100%', md: 280 } }}
                    options={productos}
                    value={producto}
                    loading={cargando}
                    getOptionLabel={etiquetaProducto}
                    isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
                    onChange={(_, nueva) => cambiarLinea(indice, 'producto_id', nueva?.id ?? '')}
                    noOptionsText="No hay productos activos"
                    renderInput={(params) => (
                      <TextField {...params} label={`Producto ${indice + 1}`} error={Boolean(erroresLinea.producto_id)} helperText={erroresLinea.producto_id} />
                    )}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={`Cantidad ${indice + 1}`}
                    value={linea.cantidad}
                    onChange={(evento) => cambiarLinea(indice, 'cantidad', evento.target.value)}
                    error={Boolean(erroresLinea.cantidad)}
                    helperText={erroresLinea.cantidad}
                    slotProps={{ htmlInput: { min: 1, step: 1, inputMode: 'numeric' } }}
                    sx={{ width: { xs: '100%', md: 140 } }}
                  />
                  <IconButton
                    aria-label={`Quitar el producto ${indice + 1}`}
                    onClick={() => setFormulario((previo) => ({ ...previo, lineas: previo.lineas.filter((_, i) => i !== indice) }))}
                    sx={{ alignSelf: { xs: 'flex-end', md: 'center' } }}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              )
            })}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" useFlexGap flexWrap="wrap">
            <Button
              startIcon={<AddIcon />}
              onClick={() => setFormulario((previo) => ({ ...previo, lineas: [...previo.lineas, lineaLoteVacia()] }))}
              disabled={formulario.lineas.length >= MAXIMO_LINEAS_LOTE}
            >
              Agregar producto
            </Button>
            <Typography variant="xs">
              {unidades} {unidades === 1 ? 'unidad' : 'unidades'} en {formulario.lineas.length} {formulario.lineas.length === 1 ? 'producto' : 'productos'}
            </Typography>
          </Stack>
          {errores.lineas ? <Typography variant="xs" color="error" sx={{ mt: 0.5 }}>{errores.lineas}</Typography> : null}
        </Box>

        <Stack direction="row" justifyContent="flex-end">
          <Button type="submit" variant="contained" disabled={enviando || cargando || errorCatalogos || formulario.lineas.length === 0} sx={{ minWidth: 160 }}>
            {enviando ? 'Registrando…' : 'Confirmar'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
