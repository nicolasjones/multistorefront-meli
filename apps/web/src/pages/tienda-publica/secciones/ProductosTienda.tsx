import { useEffect, useState } from 'react'
import { Alert, Box, Chip, Stack, Typography } from '@mui/material'
import { formatearPrecioTienda, leerCatalogoPublico, type CatalogoPublico } from '../../../lib/tiendaCatalogo'
import type { PropsSeccionTienda } from '../PaginaTienda'

export const orden = 50

// Sección pública mínima del catálogo (F-TDA-04, FR-049): destacados primero y solo lo que devuelve
// publico.catalogo_visible_por_dominio. Sin ficha, carrito ni búsqueda (MSF-167). No muestra la
// imagen: el bucket de imágenes de producto es privado y la entrega pública la resuelve MSF-167.
export default function ProductosTienda({ host }: PropsSeccionTienda) {
  const [catalogo, setCatalogo] = useState<CatalogoPublico | null>(null)
  const [hayError, setHayError] = useState(false)

  useEffect(() => {
    let vigente = true
    setCatalogo(null)
    setHayError(false)
    leerCatalogoPublico(host)
      .then((resultado) => { if (vigente) setCatalogo(resultado) })
      .catch((error: unknown) => {
        console.error('No se pudo cargar el catálogo público', error instanceof Error ? error.message : error)
        if (vigente) setHayError(true)
      })
    return () => { vigente = false }
  }, [host])

  if (hayError) {
    return <Alert severity="error" role="alert">No pudimos cargar los productos. Probá de nuevo en un rato.</Alert>
  }
  if (!catalogo || catalogo.productos.length === 0) {
    return null
  }

  return (
    <Box component="section" aria-labelledby="productos-tienda-titulo">
      <Typography id="productos-tienda-titulo" component="h2" variant="h6" sx={{ mb: 1 }}>Productos</Typography>
      <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {catalogo.productos.map((producto) => (
          <Stack
            component="li"
            key={producto.id}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={2}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 2, py: 1 }}
          >
            <Box>
              <Typography>{producto.nombre}</Typography>
              {producto.destacado ? <Chip size="small" color="warning" label="Destacado" sx={{ mt: 0.5 }} /> : null}
            </Box>
            <Typography>{formatearPrecioTienda(producto.moneda, producto.precio)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
