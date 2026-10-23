import { Box, Button, Typography } from '@mui/material'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { ENLACE_DESTINO_BOTON, type ContenidoTienda } from '../../../lib/tiendaContenido'
import type { PropsSeccionTienda } from '../PaginaTienda'

export const orden = 20

// Banner principal de la home, también usado por la vista previa de la gestión (FR-037): un
// mismo componente, así lo que se previsualiza es lo que se publica. Texto plano (React lo
// escapa); cada elemento vacío se oculta y, sin ninguno, no se muestra el banner (FR-034).
export function BannerContenido({ contenido }: { contenido: Pick<ContenidoTienda, 'titulo' | 'subtitulo' | 'texto_boton' | 'boton_destino'> }) {
  const titulo = contenido.titulo.trim()
  const subtitulo = contenido.subtitulo.trim()
  const textoBoton = contenido.texto_boton.trim()
  if (!titulo && !subtitulo && !textoBoton) return null
  return (
    <Box component="section" aria-label="Banner principal" data-testid="banner-home" sx={{ px: 2, py: 4 }}>
      {titulo ? <Typography component="h2" variant="h4">{titulo}</Typography> : null}
      {subtitulo ? <Typography variant="body1" sx={{ mt: 1 }}>{subtitulo}</Typography> : null}
      {textoBoton ? (
        <Button component="a" href={ENLACE_DESTINO_BOTON[contenido.boton_destino]} variant="contained" sx={{ mt: 2 }}>
          {textoBoton}
        </Button>
      ) : null}
    </Box>
  )
}

export default function BannerHome({ host }: PropsSeccionTienda) {
  const contenido = useContenidoPublico(host)
  return contenido ? <BannerContenido contenido={contenido} /> : null
}
