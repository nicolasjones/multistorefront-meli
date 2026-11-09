import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControlLabel,
  MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError } from '../estados/EstadosPagina'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useProveedoresBasico } from '../../hooks/useProveedoresBasico'
import { useCrearOrdenCompra, useProductosEnReposicion } from '../../hooks/useOrdenesCompra'
import {
  LARGO_MAXIMO_OBSERVACIONES, formularioOrdenVacio, lineasParaRpc,
  mensajeDeErrorOrden, validarOrden, type ErroresOrden, type FormularioOrden,
} from '../../lib/ordenesCompra'

type Props = {
  abierto: boolean
  onCerrar: () => void
  onCreada: (ordenId: string) => void
  // La empresa activa cambió con el diálogo abierto: se cierra con aviso (Principio VIII).
  onCambioEmpresa?: () => void
}

const MENSAJE_POR_DEFECTO = 'No pudimos crear la orden de compra. Intentá de nuevo.'

// F-PRV-09: alta de una orden de compra a proveedor. Los productos salen del listado de
// reposición de Stock (los del proveedor elegido que están en alerta) y la cantidad
// sugerida es `max(1, mínimo − disponible)`. La base valida empresa, proveedor, fecha,
// productos y permiso: el diálogo solo muestra el resultado.
export function OrdenCompraFormDialog({ abierto, onCerrar, onCreada, onCambioEmpresa }: Props) {
  return (
    <Dialog open={abierto} onClose={onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-nueva-orden-compra">
      {/* El contenido se monta al abrir: cada apertura parte sin errores previos. */}
      <Contenido onCerrar={onCerrar} onCreada={onCreada} onCambioEmpresa={onCambioEmpresa} />
    </Dialog>
  )
}

function Contenido({ onCerrar, onCreada, onCambioEmpresa }: Omit<Props, 'abierto'>) {
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresasAccesibles()
  const { proveedores, cargando: cargandoProveedores, hayError: errorProveedores } = useProveedoresBasico()
  const [formulario, setFormulario] = useState<FormularioOrden>(() => formularioOrdenVacio())
  const [intento, setIntento] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const { crear, enviando } = useCrearOrdenCompra()
  // Empresa activa al abrir: si cambia, el diálogo se cierra con aviso (Principio VIII).
  const empresaAlAbrir = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (empresaAlAbrir.current === undefined) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaAlAbrir.current === empresaActivaId) return
    empresaAlAbrir.current = empresaActivaId
    onCambioEmpresa?.()
  }, [empresaActivaId, onCambioEmpresa])

  const proveedoresActivos = useMemo(() => proveedores.filter((proveedor) => proveedor.activo), [proveedores])
  const { productos, cargando: cargandoProductos, hayError: errorProductos } = useProductosEnReposicion(formulario.proveedor_id)

  // La empresa activa de la barra superior es el valor inicial de «Empresa de la compra».
  useEffect(() => {
    if (!empresaActivaId) return
    setFormulario((previo) => (previo.empresa_id === '' ? { ...previo, empresa_id: empresaActivaId } : previo))
  }, [empresaActivaId])

  const cambiar = <C extends keyof FormularioOrden>(campo: C, valor: FormularioOrden[C]) => {
    setFormulario((previo) => ({ ...previo, [campo]: valor }))
  }

  // Cambiar de proveedor deja las líneas de lado: los productos son de otro proveedor.
  const cambiarProveedor = (proveedorId: string) => {
    setFormulario((previo) => ({ ...previo, proveedor_id: proveedorId, lineas: [] }))
    setIntento(false)
  }

  const alternarProducto = (productoId: string, cantidadSugerida: number) => {
    setFormulario((previo) => {
      const existe = previo.lineas.some((linea) => linea.producto_id === productoId)
      const lineas = existe
        ? previo.lineas.filter((linea) => linea.producto_id !== productoId)
        : [...previo.lineas, { producto_id: productoId, cantidad: String(cantidadSugerida) }]
      return { ...previo, lineas }
    })
  }

  const cambiarCantidad = (indice: number, cantidad: string) => {
    setFormulario((previo) => ({
      ...previo,
      lineas: previo.lineas.map((linea, i) => (i === indice ? { ...linea, cantidad } : linea)),
    }))
  }

  const errores: ErroresOrden = intento ? validarOrden(formulario) : {}
  const unidades = formulario.lineas.reduce((total, linea) => total + (Number(linea.cantidad) || 0), 0)

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enviando) return
    setIntento(true)
    setErrorEnvio(null)
    if (Object.keys(validarOrden(formulario)).length > 0) return

    const resultado = await crear({
      empresa_id: formulario.empresa_id,
      proveedor_id: formulario.proveedor_id,
      fecha: formulario.fecha,
      observaciones: formulario.observaciones,
      items: lineasParaRpc(formulario.lineas),
    })
    if (!resultado.ok) {
      setErrorEnvio(mensajeDeErrorOrden(resultado.error, MENSAJE_POR_DEFECTO))
      return
    }
    onCreada(resultado.id)
  }

  const cerrar = () => {
    if (enviando) return
    onCerrar()
  }

  return (
    <form onSubmit={(evento) => void enviar(evento)} noValidate>
      <TituloDialogo id="titulo-nueva-orden-compra" onCerrar={cerrar}>Nueva orden de compra</TituloDialogo>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorEnvio ? <Alert severity="error">{errorEnvio}</Alert> : null}
          {errorEmpresas || errorProveedores ? (
            <Alert severity="error">No pudimos cargar las empresas o los proveedores. Recargá la página para reintentar.</Alert>
          ) : null}

          <TextField
            select
            label="Empresa de la compra"
            value={formulario.empresa_id}
            onChange={(evento) => cambiar('empresa_id', evento.target.value)}
            error={Boolean(errores.empresa_id)}
            helperText={errores.empresa_id ?? 'La empresa activa de la barra superior es la que se usa por omisión.'}
            disabled={cargandoEmpresas || enviando}
            SelectProps={{ displayEmpty: true }}
          >
            {empresas.map((opcion) => (
              <MenuItem key={opcion.id} value={opcion.id}>{opcion.nombre}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Proveedor"
            value={formulario.proveedor_id}
            onChange={(evento) => cambiarProveedor(evento.target.value)}
            error={Boolean(errores.proveedor_id)}
            helperText={errores.proveedor_id ?? 'La orden es para un solo proveedor: el de los productos en alerta.'}
            disabled={cargandoProveedores || enviando}
            SelectProps={{ displayEmpty: true }}
          >
            {proveedoresActivos.map((opcion) => (
              <MenuItem key={opcion.id} value={opcion.id}>{opcion.razon_social}</MenuItem>
            ))}
          </TextField>

          <TextField
            type="date"
            label="Fecha de la orden"
            value={formulario.fecha}
            onChange={(evento) => cambiar('fecha', evento.target.value)}
            error={Boolean(errores.fecha)}
            helperText={errores.fecha}
            disabled={enviando}
            slotProps={{ inputLabel: { shrink: true } }}
          />

          <Box>
            <Typography variant="bl" component="h3">Productos en alerta de reposición</Typography>
            {errores.lineas ? <Typography variant="xs" color="error">{errores.lineas}</Typography> : null}
            {!formulario.proveedor_id ? (
              <Typography variant="xs">Elegí un proveedor para ver sus productos en alerta.</Typography>
            ) : cargandoProductos ? (
              <EstadoCargaPagina />
            ) : errorProductos ? (
              <EstadoError descripcion="No pudimos cargar los productos en reposición." />
            ) : productos.length === 0 ? (
              <Typography variant="xs">Este proveedor no tiene productos en alerta de reposición.</Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {productos.map((producto) => {
                  const indice = formulario.lineas.findIndex((linea) => linea.producto_id === producto.producto_id)
                  const elegido = indice >= 0
                  const errorLinea = errores.porLinea?.[indice]?.cantidad
                  return (
                    <Stack key={producto.producto_id} spacing={0.5}>
                      <FormControlLabel
                        control={(
                          <Checkbox
                            checked={elegido}
                            onChange={() => alternarProducto(producto.producto_id, producto.cantidad_sugerida)}
                            disabled={enviando}
                          />
                        )}
                        label={`${producto.nombre}${producto.sku ? ` · ${producto.sku}` : ''}`}
                      />
                      <Typography variant="xs" sx={{ ml: 4 }}>
                        {producto.estado === 'sin_stock' ? 'Sin stock' : 'Stock bajo'} · disponible {producto.disponible} · mínimo {producto.minimo}
                      </Typography>
                      {elegido ? (
                        <TextField
                          size="small"
                          type="number"
                          label="Cantidad a pedir"
                          value={formulario.lineas[indice].cantidad}
                          onChange={(evento) => cambiarCantidad(indice, evento.target.value)}
                          error={Boolean(errorLinea)}
                          helperText={errorLinea ?? `Sugerido: ${producto.cantidad_sugerida}`}
                          disabled={enviando}
                          sx={{ ml: 4, width: 200 }}
                          slotProps={{ htmlInput: { min: 1, max: 1000000 } }}
                        />
                      ) : null}
                    </Stack>
                  )
                })}
              </Stack>
            )}
          </Box>

          <TextField
            label="Observaciones (opcional)"
            value={formulario.observaciones}
            onChange={(evento) => cambiar('observaciones', evento.target.value)}
            error={Boolean(errores.observaciones)}
            helperText={errores.observaciones ?? `${formulario.observaciones.trim().length}/${LARGO_MAXIMO_OBSERVACIONES}`}
            multiline
            minRows={2}
            disabled={enviando}
            slotProps={{ htmlInput: { maxLength: LARGO_MAXIMO_OBSERVACIONES } }}
          />

          <Typography variant="xs">{unidades} unidades a pedir.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={cerrar} disabled={enviando}>Cancelar</Button>
        <Button type="submit" variant="contained" disabled={enviando}>
          {enviando ? 'Creando…' : 'Crear orden de compra'}
        </Button>
      </DialogActions>
    </form>
  )
}
