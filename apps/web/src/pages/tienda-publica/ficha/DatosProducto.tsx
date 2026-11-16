import { Box, Button, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import type { FichaProducto } from '../../../lib/tiendaFicha'
import { BotonFavorito } from '../cuenta/BotonFavorito'
import { BotonAgregarALista, LineaListaFicha } from '../lista/BotonAgregarALista'
import { MigasTienda } from '../layout/MigasTienda'
import { useCelular } from '../useAnchoCelular'
import { PrecioTachado } from '../catalogo/PrecioTachado'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'
import { BotonWhatsApp } from '../whatsapp/BotonWhatsApp'
import { BotonCompartir } from './BotonCompartir'
import { LINEA_SUAVE } from '../layout/medidas'

// Fila de dato del prototipo: rótulo en gris a la izquierda, valor a la derecha (500) y una línea inferior; 15 px.
function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: '10px', borderBottom: LINEA_SUAVE, fontSize: 15 /* estilos-sueltos: ok */ }}>
      <Typography component="dt" color="text.secondary" sx={{ fontSize: 'inherit' }}>{rotulo}</Typography>
      <Typography component="dd" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right', fontSize: 'inherit', fontWeight: 500 }}>{children}</Typography>
    </Box>
  )
}

// Migas y datos de la ficha (F-TDA-13, FR-054). Todo texto va como nodo de React (se escapa solo): una
// descripción con HTML o <script> se ve literal. La descripción respeta los saltos de línea.
export function Migas({ nombre }: { nombre: string }) {
  return <MigasTienda items={[{ texto: 'Inicio', a: '/' }, { texto: 'Todos los productos', a: '/catalogo' }, { texto: nombre }]} />
}

export function DatosProducto({ ficha, host, empresa }: { ficha: FichaProducto; host: string; empresa: string }) {
  const movil = useCelular()
  return (
    <Box>
      {ficha.categoria ? <Typography color="text.secondary" sx={{ fontSize: { xs: 13, md: 14 }, mb: { xs: 0, md: '8px' } /* estilos-sueltos: ok */ }}>{ficha.categoria.nombre}</Typography> : null}
      <Typography component="h1" variant="h4" sx={{ fontSize: { xs: 30, md: 44 }, lineHeight: { xs: 1.1, md: 1.05 }, mt: { xs: '4px', md: 0 }, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>{ficha.nombre}</Typography>
      <Box sx={{ mt: { xs: '14px', md: '20px' } }}><PrecioTachado precio={ficha.precio} precioAnterior={ficha.precioAnterior} tamano={{ xs: 34, md: 44 }} /></Box>
      <Box sx={{ mt: { xs: '8px', md: '12px' }, display: 'flex' }}><EtiquetaDisponibilidad disponible={ficha.disponible} tamano="ficha" /></Box>
      {ficha.descripcion ? <Typography sx={{ mt: { xs: '16px', md: '24px' }, fontSize: { xs: 16, md: 17 }, lineHeight: 1.6, whiteSpace: 'pre-line' /* estilos-sueltos: ok */ }}>{ficha.descripcion}</Typography> : null}
      <Box component="dl" aria-label="Datos del producto" sx={{ m: 0, mt: '24px' }}>
        {ficha.sku ? <Dato rotulo="SKU">{ficha.sku}</Dato> : null}
        {ficha.categoria ? <Dato rotulo="Categoría">{ficha.categoria.nombre}</Dato> : null}
        <Dato rotulo="Disponibilidad">{ficha.disponible ? 'Disponible' : 'Sin stock'}</Dato>
      </Box>
      {/* Fila de acciones (F-TDA-14, FR-020): el prototipo muestra los dos botones juntos, el de
          WhatsApp relleno y «Ver más productos» con borde de 2 px. Sin número válido el botón de WhatsApp no
          existe: la ficha se ve sin botón y sin hueco. */}
      <Box data-testid="acciones-ficha" sx={{ mt: { xs: '20px', md: '28px' }, display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: '12px' }}>
        <BotonWhatsApp
          host={host}
          empresa={empresa}
          producto={ficha.nombre}
          productoId={ficha.id}
          precio={ficha.precio}
        />
        {/* «Agregar a la lista» (MSF-176, B1, P-2): segundo en la tabulación, solo con la función encendida; no mueve los botones del prototipo. */}
        <BotonAgregarALista host={host} productoId={ficha.id} nombre={ficha.nombre} />
        {/* «Ver más productos» no está en el prototipo móvil (`MJC_M_Producto`): solo escritorio. */}
        {movil ? null : (
        <Button
          component={EnlaceRuta}
          to="/catalogo"
          variant="outlined"
          sx={{ fontSize: 16, px: '24px', py: '12px', border: '2px solid', borderColor: 'primary.main', width: { xs: '100%', sm: 'auto' }, '&:hover': { border: '2px solid', borderColor: 'primary.main' } /* estilos-sueltos: ok */ }}
        >
          Ver más productos
        </Button>
        )}
        {/* «Compartir» (F-TDA-25) no está en el prototipo: va después de los dos botones del prototipo, que quedan juntos. */}
        <BotonCompartir productoId={ficha.id} nombre={ficha.nombre} />
      </Box>
      {/* «Guardar en favoritos» (F-CLI-20, P-2): debajo de los botones y último en la tabulación; solo con la función encendida. */}
      <BotonFavorito host={host} productoId={ficha.id} nombre={ficha.nombre} />
      {/* «Sin stock hoy…» y «Ya tenés n en tu lista · Ver lista» (B1, P-2). */}
      <LineaListaFicha host={host} productoId={ficha.id} disponible={ficha.disponible} />
      <Typography color="text.secondary" sx={{ mt: '14px', fontSize: 13 /* estilos-sueltos: ok */ }}>Precios y disponibilidad sujetos a cambios.</Typography>
    </Box>
  )
}
