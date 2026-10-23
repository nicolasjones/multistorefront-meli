import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton,
  InputAdornment, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import SearchIcon from '@mui/icons-material/Search'
import { useWarnAboutChange } from '@refinedev/core'
import { useCatalogoTienda } from '../../../../hooks/useCatalogoTienda'
import { formatearPrecioTienda, type ProductoTienda } from '../../../../lib/tiendaCatalogo'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../../components/estados/EstadosPagina'
import type { PropsPestanaTienda } from '../pestanas'

const AYUDA_CATEGORIAS = 'Las categorías ocultas no aparecen en el menú ni en los filtros de esta store.'
const AYUDA_PRODUCTOS = 'Un producto inactivo o sin la categoría visible no se muestra aunque esté marcado.'

// Pestaña «Catálogo visible» de la gestión de la tienda (F-TDA-04, FR-041…FR-048). Precio y stock son
// de lectura (D2). La visibilidad efectiva, el motivo y el resumen salen de la base: lo que ve esta
// pantalla como «lo que se muestra» es lo guardado; los interruptores y estrellas son un borrador
// hasta «Guardar».
export default function PestanaCatalogo({ empresaId, empresaNombre }: PropsPestanaTienda) {
  const {
    catalogo, isLoading, isError, refetch, guardando, errorGuardado, hayCambios,
    categoriaVisible, productoVisible, productoDestacado, cambiarCategoria, cambiarProducto, guardar, descartar,
  } = useCatalogoTienda(empresaId)
  const { setWarnWhen } = useWarnAboutChange()
  const [busqueda, setBusqueda] = useState('')
  const [porDestacar, setPorDestacar] = useState<ProductoTienda | null>(null)

  // El aviso de «cambios sin guardar» al cambiar de empresa lo gobierna la gestión (Principio VIII).
  useEffect(() => {
    setWarnWhen(hayCambios)
    return () => setWarnWhen(false)
  }, [hayCambios, setWarnWhen])

  // Un diálogo abierto no sobrevive al cambio de empresa: nunca destaca un producto de la anterior.
  useEffect(() => {
    setPorDestacar(null)
    setBusqueda('')
  }, [empresaId])

  const productosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()
    const productos = catalogo?.productos ?? []
    return texto ? productos.filter((p) => p.nombre.toLowerCase().includes(texto)) : productos
  }, [catalogo, busqueda])

  const categoriasOrdenadas = useMemo(() => {
    const todas = catalogo?.categorias ?? []
    const raices = todas.filter((c) => c.padreId === null)
    return raices.flatMap((raiz) => [
      { ...raiz, nivel: 0 },
      ...todas.filter((c) => c.padreId === raiz.id).map((hija) => ({ ...hija, nivel: 1 })),
    ])
  }, [catalogo])

  if (isLoading) {
    return <EstadoCargaPagina />
  }
  if (isError || !catalogo) {
    return <EstadoError descripcion="No pudimos cargar el catálogo de esta tienda." reintentar={() => void refetch()} />
  }

  // «No se muestra» = lo guardado no lo muestra, o el borrador lo oculta.
  const noSeMuestra = (p: ProductoTienda) => p.motivo !== null || !productoVisible(p)

  const alternarDestacado = (p: ProductoTienda) => {
    if (productoDestacado(p)) {
      cambiarProducto(p.id, { destacado: false })
    } else if (noSeMuestra(p)) {
      setPorDestacar(p)
    } else {
      cambiarProducto(p.id, { destacado: true })
    }
  }

  const confirmarDestacado = () => {
    if (porDestacar) {
      cambiarProducto(porDestacar.id, { destacado: true })
    }
    setPorDestacar(null)
  }

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary" aria-live="polite">
        {catalogo.resumen.visibles} visibles, {catalogo.resumen.destacados} destacados
      </Typography>

      {hayCambios ? (
        <Alert
          severity="warning"
          action={(
            <Stack direction="row" spacing={1}>
              <Button color="inherit" disabled={guardando} onClick={descartar}>Descartar</Button>
              <Button color="inherit" variant="outlined" disabled={guardando} onClick={() => void guardar()}>Guardar</Button>
            </Stack>
          )}
        >
          Hay cambios sin guardar
        </Alert>
      ) : null}
      {errorGuardado ? <Alert severity="error" role="alert">{errorGuardado}</Alert> : null}

      <Box component="section" aria-labelledby="categorias-visibles-titulo">
        <Typography id="categorias-visibles-titulo" component="h2" variant="h6">Categorías visibles</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{AYUDA_CATEGORIAS}</Typography>
        {categoriasOrdenadas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay categorías." />
        ) : (
          <Paper variant="outlined">
            <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
              {categoriasOrdenadas.map((categoria) => (
                <Stack
                  key={categoria.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ px: 2, py: 0.5, pl: 2 + categoria.nivel * 3 }}
                >
                  <Typography>
                    {categoria.nombre} <Typography component="span" color="text.secondary">· {categoria.productos} productos</Typography>
                  </Typography>
                  <Switch
                    checked={categoriaVisible(categoria.id)}
                    onChange={(_, marcado) => cambiarCategoria(categoria.id, marcado)}
                    slotProps={{ input: { 'aria-label': `Mostrar la categoría ${categoria.nombre} en la tienda de ${empresaNombre}` } }}
                  />
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}
      </Box>

      <Box component="section" aria-labelledby="productos-visibles-titulo">
        <Typography id="productos-visibles-titulo" component="h2" variant="h6">Productos visibles y destacados</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{AYUDA_PRODUCTOS}</Typography>
        <TextField
          size="small"
          label="Buscar producto"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          sx={{ mb: 1, width: { xs: '100%', sm: 320 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        {catalogo.productos.length === 0 ? (
          <EstadoVacio titulo="Esta tienda todavía no tiene productos." descripcion="Asigná la empresa a un producto desde Productos para que aparezca acá." />
        ) : productosFiltrados.length === 0 ? (
          <EstadoVacio titulo="Ningún producto coincide con la búsqueda." />
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label={`Productos de la tienda de ${empresaNombre}`}>
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell align="right">Precio</TableCell>
                  <TableCell align="right">Stock</TableCell>
                  <TableCell align="center">Visible</TableCell>
                  <TableCell align="center">Destacado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {productosFiltrados.map((producto) => {
                  const destacado = productoDestacado(producto)
                  return (
                    <TableRow key={producto.id}>
                      <TableCell>
                        <Typography>{producto.nombre}</Typography>
                        {producto.motivo ? (
                          <Typography variant="caption" color="warning.main">{producto.motivo}</Typography>
                        ) : null}
                      </TableCell>
                      <TableCell align="right">{formatearPrecioTienda(producto.moneda, producto.precio)}</TableCell>
                      <TableCell align="right">{producto.stock}</TableCell>
                      <TableCell align="center">
                        <Switch
                          checked={productoVisible(producto)}
                          onChange={(_, marcado) => cambiarProducto(producto.id, { visible: marcado })}
                          slotProps={{ input: { 'aria-label': `Mostrar ${producto.nombre} en la tienda` } }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          aria-label={destacado ? `Quitar destacado de ${producto.nombre}` : `Destacar ${producto.nombre}`}
                          aria-pressed={destacado}
                          onClick={() => alternarDestacado(producto)}
                          color={destacado ? 'warning' : 'default'}
                        >
                          {destacado ? <StarIcon /> : <StarBorderIcon />}
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Dialog open={porDestacar !== null} onClose={() => setPorDestacar(null)} aria-labelledby="destacar-no-visible-titulo">
        <DialogTitle id="destacar-no-visible-titulo">{porDestacar?.nombre}</DialogTitle>
        <DialogContent>
          <DialogContentText>Este producto no se muestra en la tienda. ¿Destacarlo igual?</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPorDestacar(null)} autoFocus>Cancelar</Button>
          <Button onClick={confirmarDestacado}>Destacar igual</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
