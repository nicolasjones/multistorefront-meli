import { useState } from 'react'
import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import type { ProductoListado } from '../../../lib/tiendaListado'
import { PrecioTachado } from './PrecioTachado'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'
import { LINEA_SUAVE } from '../layout/medidas'

// Tarjeta de producto de la tienda (F-TDA-12, FR-037; MSF-847, prototipo `MJC_Catalogo`/`MJC_Home`/`MJC_Producto`):
// borde de 1 px, radio 8 y fondo blanco; área de imagen cuadrada con el fondo de superficie y la imagen COMPLETA
// (`contain`, hasta el 86 % del área: no se recorta); cuerpo con el nombre (a lo sumo 2 líneas), el precio en la tipografía
// de títulos y el color primario, y la disponibilidad con su punto. Toda la tarjeta enlaza a la ficha. El texto va como
// nodo de React (se escapa solo). «Sin stock» se distingue además del texto con la insignia sobre la imagen atenuada.
// Si la URL firmada vence (1 h) o la imagen falla al cargar, `onError` cae a «Sin imagen» en vez de dejar el ícono roto.
// En celular las medidas son las de `MJC_M_Catalogo` (cuerpo de 10 px, nombre de 14 px, precio de 18 px).
export function TarjetaProducto({ producto, urlImagen }: { producto: ProductoListado; urlImagen?: string }) {
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
        display: 'block', height: '100%', boxSizing: 'border-box', overflow: 'hidden', bgcolor: 'background.paper',
        color: 'inherit', textDecoration: 'none', border: LINEA_SUAVE, borderRadius: '8px', // estilos-sueltos: ok
        '&:hover, &:focus-visible': { borderColor: 'text.primary' },
      }}
    >
      <Box
        data-testid="tarjeta-imagen"
        sx={(tema) => ({
          position: 'relative', aspectRatio: { xs: '171 / 159', md: '1 / 1' }, bgcolor: tema.tienda?.superficie ?? 'action.hover', // estilos-sueltos: ok
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        })}
      >
        {mostrarImagen ? (
          <Box component="img" src={urlImagen} alt="" loading="lazy" onError={() => setFallo(urlImagen ?? null)} sx={{ maxWidth: '86%', maxHeight: '86%', objectFit: 'contain', opacity: sinStock ? 0.45 : 1 }} />
        ) : (
          <Typography component="span" sx={{ color: 'text.secondary', fontSize: 13 /* estilos-sueltos: ok */ }}>Sin imagen</Typography>
        )}
        {sinStock ? (
          <Typography
            component="span"
            data-testid="tarjeta-sin-stock"
            aria-hidden
            sx={{ position: 'absolute', left: 10, top: 10, bgcolor: '#fff', color: '#6B6B6B', fontSize: 12, fontWeight: 600, px: '8px', py: '3px', borderRadius: '4px' /* estilos-sueltos: ok */ }}
          >
            Sin stock
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ p: { xs: '10px', md: '14px' } }}>
        <Typography
          component="h3"
          data-testid="tarjeta-nombre"
          sx={{
            fontSize: { xs: 14, md: 16 }, fontWeight: 500, lineHeight: 1.3, height: { xs: 36, md: 42 }, overflow: 'hidden', overflowWrap: 'anywhere', // estilos-sueltos: ok
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}
        >
          {producto.nombre}
        </Typography>
        <Box sx={{ mt: '8px' }}>
          <PrecioTachado precio={producto.precio} precioAnterior={producto.precioAnterior} />
        </Box>
        <Box sx={{ mt: '6px', display: 'flex' }}>
          <EtiquetaDisponibilidad disponible={producto.disponible} />
        </Box>
      </Box>
    </Box>
  )
}
