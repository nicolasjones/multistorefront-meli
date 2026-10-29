import { Box, Breadcrumbs, Button, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { formatearPrecioArs } from '../../../lib/tiendaListado'
import type { FichaProducto } from '../../../lib/tiendaFicha'
import EtiquetaDisponibilidad from '../disponibilidad/EtiquetaDisponibilidad'
import { BotonWhatsApp } from '../whatsapp/BotonWhatsApp'

function Dato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography component="dt" color="text.secondary">{rotulo}</Typography>
      <Typography component="dd" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right' }}>{children}</Typography>
    </Box>
  )
}

// Migas y datos de la ficha (F-TDA-13, FR-054). Todo texto va como nodo de React (se escapa solo): una
// descripción con HTML o <script> se ve literal. La descripción respeta los saltos de línea.
export function Migas({ nombre }: { nombre: string }) {
  return (
    <Breadcrumbs aria-label="Migas de pan" sx={{ mb: 2 }}>
      <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit' }}>Inicio</Box>
      <Box component={EnlaceRuta} to="/catalogo" sx={{ color: 'inherit' }}>Todos los productos</Box>
      <Typography color="text.primary" aria-current="page">{nombre}</Typography>
    </Breadcrumbs>
  )
}

export function DatosProducto({ ficha, host, empresa }: { ficha: FichaProducto; host: string; empresa: string }) {
  const precio = formatearPrecioArs(ficha.precio)
  return (
    <Box>
      {ficha.categoria ? <Typography color="text.secondary" variant="body2">{ficha.categoria.nombre}</Typography> : null}
      <Typography component="h1" variant="h4" sx={{ mb: 1, typography: { xs: 'h5', md: 'h4' }, overflowWrap: 'anywhere' }}>{ficha.nombre}</Typography>
      {precio ? <Typography component="p" variant="h5" sx={{ mb: 0.5 }}>{precio}</Typography> : null}
      <Box sx={{ mb: 2 }}><EtiquetaDisponibilidad disponible={ficha.disponible} /></Box>
      {ficha.descripcion ? <Typography sx={{ mb: 2, whiteSpace: 'pre-line' }}>{ficha.descripcion}</Typography> : null}
      <Box component="dl" aria-label="Datos del producto" sx={{ m: 0, mb: 2 }}>
        {ficha.sku ? <Dato rotulo="SKU">{ficha.sku}</Dato> : null}
        {ficha.categoria ? <Dato rotulo="Categoría">{ficha.categoria.nombre}</Dato> : null}
        <Dato rotulo="Disponibilidad">{ficha.disponible ? 'Disponible' : 'Sin stock'}</Dato>
      </Box>
      {/* Fila de acciones (F-TDA-14, FR-020): el prototipo muestra los dos botones juntos, el de
          WhatsApp filled y «Ver más productos» con borde. Sin número válido el botón de WhatsApp no
          existe: la ficha se ve sin botón y sin hueco. */}
      <Box data-testid="acciones-ficha" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        <BotonWhatsApp
          host={host}
          empresa={empresa}
          producto={ficha.nombre}
          productoId={ficha.id}
          precio={ficha.precio}
        />
        <Button component={EnlaceRuta} to="/catalogo" variant="outlined" sx={{ minHeight: (tema) => tema.spacing(5.5), fontWeight: 700, width: { xs: '100%', sm: 'auto' } }}>Ver más productos</Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Precios y disponibilidad sujetos a cambios.</Typography>
    </Box>
  )
}
