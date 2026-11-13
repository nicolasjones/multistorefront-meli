import CloseIcon from '@mui/icons-material/Close'
import MenuIcon from '@mui/icons-material/Menu'
import { Box, Drawer, IconButton, List, ListItem, ListItemButton, ListItemText, Typography, type SxProps, type Theme } from '@mui/material'
import { useState } from 'react'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'
import { NavLink, useLocation } from 'react-router'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { categoriasPrincipales, hayMasCategorias } from '../../../lib/tiendaCategorias'
import { urlPublica } from '../../../lib/tiendaIdentidad'
import { ErrorConReintento } from '../ErrorConReintento'
import { useIdentidadTienda } from './IdentidadTiendaContexto'

const ID_PANEL = 'menu-movil'
const ID_TITULO = 'menu-movil-titulo'

// Menú desplegable de celular (F-TDA-17, FR-040/FR-048): el botón del encabezado abre un panel con
// «Inicio», «Contacto» (F-TDA-16, FR-010) y la sección «Categorías» (la actual marcada con aria-current). El Drawer de MUI es un modal:
// atrapa el foco, lo devuelve al botón al cerrar y cierra con Esc o al tocar afuera; además se cierra al
// navegar. Se muestra solo bajo `md`;
// desde ahí rige el menú horizontal de escritorio.
export default function MenuMovil({ categorias, empresaNombre = '' }: { categorias: CategoriasTienda; empresaNombre?: string }) {
  const logo = urlPublica(useIdentidadTienda()?.logoRuta ?? null)
  // MSF-825: las categorías principales (hasta 6) y «Más categorías» hacia el catálogo, no las ~190 de la base.
  const principales = categoriasPrincipales(categorias.categorias)
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
        sx={{ display: { xs: 'inline-flex', md: 'none' }, width: 48, height: (tema) => tema.spacing(6), ml: '-10px' /* estilos-sueltos: ok */ }}
      >
        <MenuIcon />
      </IconButton>
      <Drawer
        open={abierto}
        onClose={cerrar}
        anchor="left"
        slotProps={{ paper: { id: ID_PANEL, role: 'dialog', 'aria-modal': true, 'aria-labelledby': ID_TITULO, sx: { width: 'min(300px, 85vw)' } } }}
      >
        {/* Prototipo (`MJC_M_Home`, menú): cabecera con el logo (34 px) y la X a la derecha, 16 px de relleno y línea inferior; el
            título «Menú» queda solo para lectores de pantalla (nombre del diálogo). */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: '1px solid rgba(0,0,0,.08)' /* estilos-sueltos: ok */ }}>
          <Typography id={ID_TITULO} component="h2" sx={logo ? SOLO_LECTORES : { fontWeight: 700 }}>Menú</Typography>
          {logo ? <Box component="img" src={logo} alt={empresaNombre} sx={{ display: 'block', height: 34, width: 'auto', maxWidth: '70%', objectFit: 'contain' /* estilos-sueltos: ok */ }} /> : null}
          <IconButton aria-label="Cerrar menú" onClick={cerrar} sx={{ ml: 'auto', width: 48, height: (tema) => tema.spacing(6) }}><CloseIcon /></IconButton>
        </Box>
        <Box component="nav" aria-label="Menú de la tienda" sx={{ overflowY: 'auto', py: 1 }}>
          <List disablePadding>
            <ListItem disablePadding>
              <ListItemButton component={NavLink} to="/" end onClick={cerrar} sx={estiloEntradaPrincipal}>
                <ListItemText primary="Inicio" slotProps={{ primary: { sx: estiloTexto } }} />
              </ListItemButton>
            </ListItem>
          </List>
          <Typography component="h3" color="text.secondary" sx={{ display: 'block', px: '20px', pt: '12px', pb: '4px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'inherit' /* estilos-sueltos: ok */ }}>Categorías</Typography>
          <List disablePadding aria-busy={categorias.fase === 'cargando'}>
            {principales.map((categoria) => (
              <ListItem key={categoria.id} disablePadding>
                <ListItemButton component={NavLink} to={`/categoria/${categoria.id}`} onClick={cerrar} sx={estiloEntrada}>
                  <ListItemText primary={categoria.nombre} slotProps={{ primary: { sx: { ...estiloTexto, overflowWrap: 'anywhere' } } }} />
                </ListItemButton>
              </ListItem>
            ))}
            {hayMasCategorias(categorias.categorias, principales) ? (
              <ListItem disablePadding>
                <ListItemButton component={NavLink} to="/catalogo" end onClick={cerrar} sx={estiloEntrada}>
                  <ListItemText primary="Más categorías" slotProps={{ primary: { sx: estiloTexto } }} />
                </ListItemButton>
              </ListItem>
            ) : null}
          </List>
          <List disablePadding sx={{ mt: 1, borderTop: '1px solid rgba(0,0,0,.08)' /* estilos-sueltos: ok */ }}>
            <ListItem disablePadding>
              <ListItemButton component={NavLink} to="/contacto" onClick={cerrar} sx={estiloEntradaPrincipal}>
                <ListItemText primary="Contacto" slotProps={{ primary: { sx: estiloTexto } }} />
              </ListItemButton>
            </ListItem>
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

// Entradas del prototipo: 16 px; las categorías con 12 px de relleno vertical y 20 px a los lados; «Inicio» y «Contacto» en 600 y
// con 14 px. NavLink pone aria-current="page" en la ruta actual; acá además se resalta.
const estiloTexto = { fontSize: 16, fontWeight: 'inherit', lineHeight: 'normal' } as const // estilos-sueltos: ok
const estiloEntrada: SxProps<Theme> = {
  py: '12px', px: '20px', // estilos-sueltos: ok
  '&[aria-current="page"]': { fontWeight: 700, bgcolor: 'action.selected' },
}
const estiloEntradaPrincipal: SxProps<Theme> = {
  py: '14px', px: '20px', fontWeight: 600, // estilos-sueltos: ok
  '&[aria-current="page"]': { fontWeight: 700, bgcolor: 'action.selected' },
}
