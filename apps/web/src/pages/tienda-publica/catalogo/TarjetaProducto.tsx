import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { formatearPrecioArs, type ProductoListado } from '../../../lib/tiendaListado'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'

// Tarjeta del catálogo (F-TDA-12, FR-037): imagen o «Sin imagen», nombre, precio y disponibilidad. Toda
// la tarjeta enlaza a la ficha. El texto va como nodo de React (se escapa solo). «Sin stock» se
// distingue además del texto con la imagen atenuada y el nombre en gris. Si la URL firmada vence (1 h)
// o la imagen falla al cargar, `onError` cae a «Sin imagen» en vez de dejar el ícono roto.
export function TarjetaProducto({ producto, urlImagen }: { producto: ProductoListado; urlImagen?: string }) {
  const precio = formatearPrecioArs(producto.precio)
  const sinStock = !producto.disponible
  const [fallo, setFallo] = useState<string | null>(null)
  const mostrarImagen = Boolean(urlImagen) && fallo !== urlImagen
  return (
    <Box
      component={EnlaceRuta}
      to={`/producto/${producto.id}`}
      data-testid="tarjeta-producto"
      data-disponible={producto.disponible}
      sx={{
        display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, height: '100%', boxSizing: 'border-box',
        color: 'inherit', textDecoration: 'none', border: 1, borderColor: 'divider', borderRadius: (tema) => `${tema.shape.borderRadius}px`,
        '&:hover, &:focus-visible': { borderColor: 'text.primary' },
      }}
    >
      <Box
        sx={{
          aspectRatio: '1 / 1', bgcolor: 'action.hover', borderRadius: (tema) => `${tema.shape.borderRadius}px`, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: sinStock ? 0.55 : 1,
        }}
      >
        {mostrarImagen ? (
          <Box component="img" src={urlImagen} alt="" loading="lazy" onError={() => setFallo(urlImagen ?? null)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Typography variant="body2" color="text.secondary">Sin imagen</Typography>
        )}
      </Box>
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, color: sinStock ? 'text.secondary' : 'text.primary' }}>
        {producto.nombre}
      </Typography>
      {precio ? <Typography variant="h6" component="p">{precio}</Typography> : null}
      <EtiquetaDisponibilidad disponible={producto.disponible} />
    </Box>
  )
}
