import { useMediaQuery } from '@mui/material'

// Cortes de la tienda pública (F-TDA-17, FR-043): los mismos de MUI (`sm` 600 px, `md` 900 px). Se usa la
// consulta de texto y no `theme.breakpoints` porque no depende de que haya un ThemeProvider montado.
// Bajo `md` (celular y tableta chica) rigen el menú y el panel de filtros móviles; desde `md`, escritorio.
export const useCelular = () => useMediaQuery('(max-width:899.95px)')
// Bajo `sm`: pantallas de celular donde la ampliación de imagen ocupa toda la pantalla.
export const usePantallaChica = () => useMediaQuery('(max-width:599.95px)')
