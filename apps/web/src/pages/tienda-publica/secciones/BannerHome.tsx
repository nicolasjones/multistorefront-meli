import { Box, Typography } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { ENLACE_DESTINO_BOTON, type ContenidoTienda } from '../../../lib/tiendaContenido'
import type { PropsSeccionTienda } from '../PaginaTienda'

export const orden = 20

// Banner principal de la home, también usado por la vista previa de la gestión (FR-037): un
// mismo componente, así lo que se previsualiza es lo que se publica. Texto plano (React lo
// escapa); cada elemento vacío se oculta y, sin ninguno, no se muestra el banner (FR-034).
export function BannerContenido({ contenido, vistaPrevia = false }: { contenido: Pick<ContenidoTienda, 'titulo' | 'subtitulo' | 'texto_boton' | 'boton_destino'>; vistaPrevia?: boolean }) {
  const titulo = contenido.titulo.trim()
  const subtitulo = contenido.subtitulo.trim()
  const textoBoton = contenido.texto_boton.trim()
  if (!titulo && !subtitulo && !textoBoton) return null
  // Prototipo (`MJC_Home`/`MJC_M_Home`): franja a todo el ancho con el color de la barra (`--top`), de 440 px a escritorio; el
  // texto va a la izquierda (título de 72 px en mayúsculas, bajada de 20 px y botón primario) y dos franjas inclinadas en
  // el color de la marca cierran la composición. La franja llega a los bordes de la ventana sin ensanchar el contenido. Las tarjetas de producto que el prototipo apoya a la derecha
  // dependen de datos que el banner no tiene: no se dibujan.
  const estiloBoton = {
    display: 'block', textAlign: 'center', mt: { xs: '20px', md: '28px' }, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: '8px', // estilos-sueltos: ok
    fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: { md: '.03em' }, py: '14px', px: { xs: '14px', md: '28px' }, textDecoration: 'none', // estilos-sueltos: ok
    width: { xs: '100%', md: 'fit-content' }, '&:hover': { bgcolor: 'primary.dark' },
  } as const
  return (
    <Box
      component="section"
      aria-label="Banner principal"
      data-testid="banner-home"
      sx={(tema) => ({
        position: 'relative', color: tema.tienda?.textoBarra ?? 'common.white', bgcolor: tema.tienda?.barra ?? 'grey.900',
        minHeight: { md: 440 }, boxSizing: 'border-box', pt: { xs: '28px', md: '96px' }, pb: { xs: '28px', md: 0 }, px: { xs: '6px', md: 0 }, // estilos-sueltos: ok
      })}
    >
      {/* Capa a todo el ancho de la ventana (solo en la tienda; en la vista previa del panel la franja se queda en su recuadro):
          lleva el color de la barra y recorta las dos franjas inclinadas, que se apoyan en el borde de la ventana como en el
          prototipo. El `overflow-x: clip` del layout evita que la capa de 100vw (que incluye la barra de desplazamiento) o las franjas
          ensanchen el documento. */}
      {vistaPrevia ? null : (
        <Box
          aria-hidden
          data-testid="banner-capa"
          sx={(tema) => ({ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '100vw', transform: 'translateX(-50%)', overflow: 'hidden', bgcolor: tema.tienda?.barra ?? tema.palette.grey[900] })}
        >
          <Box
            sx={(tema) => ({ display: { xs: 'none', md: 'block' }, position: 'absolute', right: -60, bottom: 64, width: 760, height: 14, bgcolor: tema.tienda?.primarioOscuro, transform: 'skewX(-35deg)' })} // estilos-sueltos: ok
          />
          <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'absolute', right: -20, bottom: 44, width: 720, height: 6, bgcolor: 'primary.main', transform: 'skewX(-35deg)' /* estilos-sueltos: ok */ }} />
        </Box>
      )}
      <Box sx={{ position: 'relative', maxWidth: { md: 560 } }}>
        {titulo ? <Typography component="h2" variant="h1" sx={{ fontSize: { xs: 44, md: 72 }, lineHeight: 1, textTransform: 'uppercase' /* estilos-sueltos: ok */ }}>{titulo}</Typography> : null}
        {subtitulo ? <Typography sx={{ mt: { xs: '12px', md: '20px' }, fontSize: { xs: 16, md: 20 }, lineHeight: 1.45, opacity: 0.9 /* estilos-sueltos: ok */ }}>{subtitulo}</Typography> : null}
        {textoBoton ? (
          vistaPrevia ? (
            // En la vista previa del panel el botón no navega: `/catalogo` saldría de la gestión.
            <Box component="a" href="#" onClick={(e: React.MouseEvent) => e.preventDefault()} sx={estiloBoton}>
              {textoBoton}
            </Box>
          ) : (
            <Box component={EnlaceRuta} to={ENLACE_DESTINO_BOTON[contenido.boton_destino]} sx={estiloBoton}>
              {textoBoton}
            </Box>
          )
        ) : null}
      </Box>
    </Box>
  )
}

export default function BannerHome({ host }: PropsSeccionTienda) {
  const contenido = useContenidoPublico(host)
  return contenido ? <BannerContenido contenido={contenido} /> : null
}
