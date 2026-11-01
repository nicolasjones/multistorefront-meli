import { type FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Checkbox, FormControlLabel, IconButton, Snackbar,
  Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RemoveIcon from '@mui/icons-material/Remove'
import { avisoCatalogoTruncado, useBuscadorCatalogo } from '../../hooks/useBuscadorCatalogo'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useRegistrarIngreso } from '../../hooks/useRegistrarIngreso'
import {
  MAXIMO_CANTIDAD, MENSAJE_INGRESO_REGISTRADO, formularioIngresoVacio, generarClaveIdempotencia, lineaVacia,
  mensajeDeErrorIngreso, validarIngreso, type ErroresIngreso, type FormularioIngreso, type LineaIngreso,
} from '../../lib/ingresos'

type ProveedorOpcion = { id: string; razon_social: string }
type ProductoOpcion = { id: string; nombre: string; sku: string | null; proveedor_id: string | null }

const etiquetaProducto = (producto: ProductoOpcion) => (producto.sku ? `${producto.nombre} · ${producto.sku}` : producto.nombre)

const MENSAJE_ERROR_BUSQUEDA = 'No pudimos buscar productos. Probá de nuevo.'
const MENSAJE_ERROR_BUSQUEDA_PROVEEDOR = 'No pudimos buscar proveedores. Probá de nuevo.'

type SelectorProductoProps = {
  indice: number
  producto: ProductoOpcion | null
  proveedorId: string
  error: string | undefined
  onElegir: (producto: ProductoOpcion | null) => void
}

// Producto de una línea: busca en el servidor mientras se escribe (no hay tope de 500
// elegibles) y avisa cuando el catálogo se cortó.
function SelectorProducto({ indice, producto, proveedorId, error, onElegir }: SelectorProductoProps) {
  const [abierto, setAbierto] = useState(false)
  const productos = useBuscadorCatalogo<ProductoOpcion>({
    tabla: 'productos', columnas: 'id, nombre, sku, proveedor_id', columnasBusqueda: 'nombre,sku',
    orden: 'nombre', soloActivos: true, habilitado: abierto,
  })
  const ayudas = [
    producto && producto.proveedor_id === proveedorId ? 'Proveedor del producto: coincide' : null,
    productos.truncado ? avisoCatalogoTruncado('productos') : null,
  ].filter(Boolean)
  return (
    <Autocomplete
      size="small"
      sx={{ flex: 2, minWidth: { xs: '100%', md: 260 } }}
      options={producto && !productos.opciones.some((opcion) => opcion.id === producto.id) ? [producto, ...productos.opciones] : productos.opciones}
      value={producto}
      loading={productos.cargando}
      loadingText="Buscando productos…"
      filterOptions={(opciones) => opciones}
      onOpen={() => setAbierto(true)}
      onInputChange={(_, texto, motivo) => { if (motivo === 'input') productos.buscar(texto) }}
      getOptionLabel={etiquetaProducto}
      isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
      onChange={(_, nueva) => {
        onElegir(nueva)
        // Al elegir se vuelve a la lista completa: el texto buscado ya no aplica.
        productos.buscar('')
      }}
      noOptionsText={productos.error ? MENSAJE_ERROR_BUSQUEDA : 'No hay productos activos que coincidan'}
      renderInput={(params) => (
        <TextField
          {...params}
          label={`Producto ${indice + 1}`}
          error={Boolean(error) || productos.error}
          helperText={error ?? (productos.error ? MENSAJE_ERROR_BUSQUEDA : ayudas.length > 0 ? ayudas.join(' · ') : undefined)}
        />
      )}
    />
  )
}

type Props = {
  onRegistrado: () => void
}

// Formulario «Nuevo ingreso» del prototipo (F-PRV-04, FR-001/FR-002/FR-006).
// No calcula stock: la RPC atómica lo mueve por línea. La casilla de costo solo
// aparece con edición en Rentabilidad; la base vuelve a validarlo.
export function IngresoMercaderiaForm({ onRegistrado }: Props) {
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresasAccesibles()
  const { nivel: nivelStock } = useNivelSeccion('stock')
  const { nivel: nivelRentabilidad } = useNivelSeccion('rentabilidad')
  const puedeEditar = nivelStock === 'edicion'
  const puedeActualizarCosto = nivelRentabilidad === 'edicion'
  const { registrar, enviando } = useRegistrarIngreso()

  const [formulario, setFormulario] = useState<FormularioIngreso>(() => formularioIngresoVacio())
  // Lo elegido se guarda aparte: la lista visible cambia con cada búsqueda en el servidor.
  const [proveedorElegido, setProveedorElegido] = useState<ProveedorOpcion | null>(null)
  const [productosElegidos, setProductosElegidos] = useState<Record<string, ProductoOpcion>>({})
  const [proveedorAbierto, setProveedorAbierto] = useState(false)
  const proveedores = useBuscadorCatalogo<ProveedorOpcion>({
    tabla: 'proveedores', columnas: 'id, razon_social', columnasBusqueda: 'razon_social',
    orden: 'razon_social', soloActivos: true, habilitado: proveedorAbierto,
  })
  const [intento, setIntento] = useState(false)
  const [actualizarCosto, setActualizarCosto] = useState(false)
  const [claveIdempotencia, setClaveIdempotencia] = useState(generarClaveIdempotencia)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // La empresa activa de la barra superior es el valor inicial de «Compra a nombre de».
  useEffect(() => {
    if (!empresaActivaId) return
    setFormulario((previo) => (previo.empresa_id === '' ? { ...previo, empresa_id: empresaActivaId } : previo))
  }, [empresaActivaId])

  const errores: ErroresIngreso = intento ? validarIngreso(formulario) : {}
  const empresa = empresas.find((opcion) => opcion.id === formulario.empresa_id) ?? null
  const proveedor = formulario.proveedor_id !== '' && proveedorElegido?.id === formulario.proveedor_id ? proveedorElegido : null

  const unidades = useMemo(
    () => formulario.lineas.reduce((total, linea) => total + (Number(linea.cantidad) || 0), 0),
    [formulario.lineas],
  )

  const cambiar = <C extends keyof FormularioIngreso>(campo: C, valor: FormularioIngreso[C]) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
  }

  const cambiarLinea = (indice: number, campo: keyof LineaIngreso, valor: string) => {
    setFormulario((previo) => ({
      ...previo,
      lineas: previo.lineas.map((linea, i) => (i === indice ? { ...linea, [campo]: valor } : linea)),
    }))
  }

  const agregarLinea = () => {
    setFormulario((previo) => ({ ...previo, lineas: [...previo.lineas, lineaVacia()] }))
  }

  const quitarLinea = (indice: number) => {
    setFormulario((previo) => ({ ...previo, lineas: previo.lineas.filter((_, i) => i !== indice) }))
  }

  const limpiar = () => {
    setFormulario({ ...formularioIngresoVacio(), empresa_id: formulario.empresa_id, proveedor_id: formulario.proveedor_id })
    setActualizarCosto(false)
    setIntento(false)
    setErrorEnvio(null)
    setClaveIdempotencia(generarClaveIdempotencia())
  }

  const registrarIngreso = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enviando || !puedeEditar) return
    setIntento(true)
    setErrorEnvio(null)
    const revision = validarIngreso(formulario)
    if (Object.keys(revision).length > 0) return

    const resultado = await registrar({
      empresaId: formulario.empresa_id,
      proveedorId: formulario.proveedor_id,
      fecha: formulario.fecha,
      comprobante: formulario.comprobante,
      lineas: formulario.lineas,
      actualizarCosto: puedeActualizarCosto && actualizarCosto,
      claveIdempotencia,
    })
    if (!resultado.ok) {
      setErrorEnvio(mensajeDeErrorIngreso(resultado.error, 'No pudimos registrar el ingreso. Intentá de nuevo.'))
      return
    }

    setAviso(`${MENSAJE_INGRESO_REGISTRADO} · ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`)
    setFormulario({ ...formularioIngresoVacio(), empresa_id: formulario.empresa_id, proveedor_id: formulario.proveedor_id })
    setActualizarCosto(false)
    setIntento(false)
    setClaveIdempotencia(generarClaveIdempotencia())
    onRegistrado()
  }

  if (!puedeEditar) return null

  const catalogosListos = !cargandoEmpresas && !errorEmpresas

  return (
    <Box component="form" onSubmit={(evento) => void registrarIngreso(evento)} noValidate>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" useFlexGap flexWrap="wrap">
          <Typography variant="h3" component="h2">Nuevo ingreso</Typography>
          <Typography variant="xs">El stock es compartido: lo ven todas las tiendas.</Typography>
        </Stack>

        {errorEmpresas ? (
          <Alert severity="error">No pudimos cargar las empresas. Recargá la página para reintentar.</Alert>
        ) : null}
        {errorEnvio ? <Alert severity="error">{errorEnvio}</Alert> : null}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} useFlexGap flexWrap="wrap">
          <Autocomplete
            size="small"
            sx={{ minWidth: { xs: '100%', md: 240 }, flex: 1 }}
            options={empresas}
            value={empresa}
            loading={cargandoEmpresas}
            getOptionLabel={(opcion) => opcion.nombre}
            isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
            onChange={(_, nueva) => cambiar('empresa_id', nueva?.id ?? '')}
            noOptionsText="No hay empresas accesibles"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Compra a nombre de"
                error={Boolean(errores.empresa_id)}
                helperText={errores.empresa_id ?? 'Empresa que figura en la compra.'}
              />
            )}
          />
          <Autocomplete
            size="small"
            sx={{ minWidth: { xs: '100%', md: 240 }, flex: 1 }}
            options={proveedor && !proveedores.opciones.some((opcion) => opcion.id === proveedor.id) ? [proveedor, ...proveedores.opciones] : proveedores.opciones}
            value={proveedor}
            loading={proveedores.cargando}
            loadingText="Buscando proveedores…"
            filterOptions={(opciones) => opciones}
            onOpen={() => setProveedorAbierto(true)}
            onInputChange={(_, texto, motivo) => { if (motivo === 'input') proveedores.buscar(texto) }}
            getOptionLabel={(opcion) => opcion.razon_social}
            isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
            onChange={(_, nueva) => {
              setProveedorElegido(nueva)
              cambiar('proveedor_id', nueva?.id ?? '')
              // Al elegir se vuelve a la lista completa: el texto buscado ya no aplica.
              proveedores.buscar('')
            }}
            noOptionsText={proveedores.error ? MENSAJE_ERROR_BUSQUEDA_PROVEEDOR : 'No hay proveedores activos que coincidan'}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Proveedor"
                error={Boolean(errores.proveedor_id) || proveedores.error}
                helperText={errores.proveedor_id ?? (proveedores.error ? MENSAJE_ERROR_BUSQUEDA_PROVEEDOR : proveedores.truncado ? avisoCatalogoTruncado('proveedores') : undefined)}
              />
            )}
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
            size="small"
            label="Remito o factura de compra"
            value={formulario.comprobante}
            onChange={(evento) => cambiar('comprobante', evento.target.value)}
            error={Boolean(errores.comprobante)}
            helperText={errores.comprobante ?? 'Opcional'}
            sx={{ minWidth: { xs: '100%', md: 230 }, flex: 1 }}
          />
        </Stack>

        <Box>
          <Stack direction="row" spacing={1} sx={{ px: 1, pb: 0.5 }} alignItems="center">
            <Typography variant="xs" sx={{ flex: 2 }}>Producto</Typography>
            <Typography variant="xs" sx={{ width: 150, textAlign: 'center' }}>Cantidad</Typography>
            <Typography variant="xs" sx={{ width: 150 }}>Costo unit. USD</Typography>
            <Box sx={{ width: 40 }} />
          </Stack>
          <Stack spacing={1}>
            {formulario.lineas.map((linea, indice) => {
              const producto = productosElegidos[linea.producto_id] ?? null
              const erroresLinea = errores.porLinea?.[indice] ?? {}
              return (
                <Stack key={indice} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'flex-start' }}>
                  <SelectorProducto
                    indice={indice}
                    producto={producto}
                    proveedorId={formulario.proveedor_id}
                    error={erroresLinea.producto_id}
                    onElegir={(nuevo) => {
                      if (nuevo) setProductosElegidos((previo) => ({ ...previo, [nuevo.id]: nuevo }))
                      cambiarLinea(indice, 'producto_id', nuevo?.id ?? '')
                    }}
                  />
                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: { xs: '100%', md: 150 } }}>
                    <IconButton
                      size="small"
                      aria-label={`Restar una unidad al producto ${indice + 1}`}
                      onClick={() => cambiarLinea(indice, 'cantidad', String(Math.max(1, (Number(linea.cantidad) || 1) - 1)))}
                    >
                      <RemoveIcon fontSize="small" />
                    </IconButton>
                    <TextField
                      size="small"
                      type="number"
                      label="Cantidad"
                      value={linea.cantidad}
                      onChange={(evento) => cambiarLinea(indice, 'cantidad', evento.target.value)}
                      error={Boolean(erroresLinea.cantidad)}
                      helperText={erroresLinea.cantidad}
                      slotProps={{ htmlInput: { min: 1, max: MAXIMO_CANTIDAD, step: 1, inputMode: 'numeric' } }}
                      sx={{ width: 90 }}
                    />
                    <IconButton
                      size="small"
                      aria-label={`Sumar una unidad al producto ${indice + 1}`}
                      onClick={() => cambiarLinea(indice, 'cantidad', String(Math.min(MAXIMO_CANTIDAD, (Number(linea.cantidad) || 0) + 1)))}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  <TextField
                    size="small"
                    type="number"
                    label="Costo unit. USD"
                    value={linea.costo_unitario_usd}
                    onChange={(evento) => cambiarLinea(indice, 'costo_unitario_usd', evento.target.value)}
                    error={Boolean(erroresLinea.costo_unitario_usd)}
                    helperText={erroresLinea.costo_unitario_usd}
                    slotProps={{ htmlInput: { min: 0, step: '0.01', inputMode: 'decimal' } }}
                    sx={{ width: { xs: '100%', md: 150 } }}
                  />
                  <IconButton
                    aria-label={`Quitar el producto ${indice + 1}`}
                    onClick={() => quitarLinea(indice)}
                    disabled={formulario.lineas.length === 1}
                    sx={{ alignSelf: { xs: 'flex-end', md: 'center' } }}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              )
            })}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" useFlexGap flexWrap="wrap">
            <Button startIcon={<AddIcon />} onClick={agregarLinea} disabled={formulario.lineas.length >= 100}>Agregar producto</Button>
            <Typography variant="xs">{unidades} {unidades === 1 ? 'unidad' : 'unidades'} en {formulario.lineas.length} {formulario.lineas.length === 1 ? 'producto' : 'productos'}</Typography>
          </Stack>
          {errores.lineas ? <Typography variant="xs" color="error" sx={{ mt: 0.5 }}>{errores.lineas}</Typography> : null}
        </Box>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          {puedeActualizarCosto ? (
            <FormControlLabel
              control={<Checkbox checked={actualizarCosto} onChange={(evento) => setActualizarCosto(evento.target.checked)} />}
              label="Actualizar el costo del producto con este ingreso"
            />
          ) : <Box />}
          <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: 'stretch', sm: 'auto' } }}>
            <Button onClick={limpiar} disabled={enviando}>Limpiar</Button>
            <Button type="submit" variant="contained" disabled={enviando || !catalogosListos} sx={{ minWidth: 180 }}>
              {enviando ? 'Registrando…' : 'Registrar ingreso'}
            </Button>
          </Stack>
        </Stack>

        <Typography variant="xs" color="text.secondary">
          El stock suma al depósito único de la organización; los depósitos llegan con la épica de Stock de depósitos.
        </Typography>
      </Stack>

      <Snackbar open={aviso !== null} autoHideDuration={3000} onClose={() => setAviso(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setAviso(null)} variant="filled">{aviso}</Alert>
      </Snackbar>
    </Box>
  )
}
