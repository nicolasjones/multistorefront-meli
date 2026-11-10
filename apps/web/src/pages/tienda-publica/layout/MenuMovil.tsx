import CloseIcon from '@mui/icons-material/Close'
import MenuIcon from '@mui/icons-material/Menu'
import { Box, Drawer, IconButton, List, ListItem, ListItemButton, ListItemText, Typography, type SxProps, type Theme } from '@mui/material'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { ErrorConReintento } from '../ErrorConReintento'

const ID_PANEL = 'menu-movil'
const ID_TITULO = 'menu-movil-titulo'

// Menú desplegable de celular (F-TDA-17, FR-040/FR-048): el botón del encabezado abre un panel con
// «Inicio», «Contacto» (F-TDA-16, FR-010) y la sección «Categorías» (la actual marcada con aria-current). El Drawer de MUI es un modal:
// atrapa el foco, lo devuelve al botón al cerrar y cierra con Esc o al tocar afuera; además se cierra al
// navegar. Se muestra solo bajo `md`;
// desde ahí rige el menú horizontal de escritorio.
export default function MenuMovil({ categorias }: { categorias: CategoriasTienda }) {
  // Se guarda la ruta en la que se abrió: navegar (también con atrás/adelante) lo cierra sin efectos.
  const { pathname } = useLocation()
  const [abiertoEn, setAbiertoEn] = useState<string | null>(null)
  const abierto = abiertoEn === pathname

  const cerrar = () => setAbiertoEn(null)
  return (
    <>
      <IconButton
        aria-label="Abrir menú"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? ID_PANEL : undefined}
        onClick={() => setAbiertoEn(pathname)}
        sx={{ display: { xs: 'inline-flex', md: 'none' }, width: 48, height: (tema) => tema.spacing(6) }}
      >
        <MenuIcon />
      </IconButton>
      <Drawer
        open={abierto}
        onClose={cerrar}
        anchor="left"
        slotProps={{ paper: { id: ID_PANEL, role: 'dialog', 'aria-modal': true, 'aria-labelledby': ID_TITULO, sx: { width: 'min(320px, 85vw)' } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography id={ID_TITULO} component="h2" variant="h6">Menú</Typography>
          <IconButton aria-label="Cerrar menú" onClick={cerrar} sx={{ width: 48, height: (tema) => tema.spacing(6) }}><CloseIcon /></IconButton>
        </Box>
        <Box component="nav" aria-label="Menú de la tienda" sx={{ overflowY: 'auto' }}>
          <List disablePadding>
            <ListItem disablePadding>
              <ListItemButton component={NavLink} to="/" end onClick={cerrar} sx={estiloEntrada}>
                <ListItemText primary="Inicio" />
              </ListItemButton>
            </ListItem>
            <ListItem disablePadding>
              <ListItemButton component={NavLink} to="/contacto" onClick={cerrar} sx={estiloEntrada}>
                <ListItemText primary="Contacto" />
              </ListItemButton>
            </ListItem>
          </List>
          <Typography component="h3" variant="overline" color="text.secondary" sx={{ display: 'block', px: 2, pt: 2 }}>Categorías</Typography>
          <List disablePadding aria-busy={categorias.fase === 'cargando'}>
            {categorias.categorias.map((categoria) => (
              <ListItem key={categoria.id} disablePadding>
                <ListItemButton component={NavLink} to={`/categoria/${categoria.id}`} onClick={cerrar} sx={estiloEntrada}>
                  <ListItemText primary={categoria.nombre} slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
          {categorias.fase === 'error' ? (
            <Box sx={{ p: 2 }}>
              <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
            </Box>
          ) : null}
        </Box>
      </Drawer>
    </>
  )
}

// NavLink pone aria-current="page" en la ruta actual; acá además se resalta.
const estiloEntrada: SxProps<Theme> = {
  minHeight: (tema) => tema.spacing(6),
  '&[aria-current="page"]': { fontWeight: 700, bgcolor: 'action.selected' },
}
