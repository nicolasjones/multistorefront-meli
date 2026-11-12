import { Box } from '@mui/material'
import { useContactoTienda } from '../../../hooks/useContactoTienda'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { normalizarNumero } from '../../../lib/whatsapp'
import { IconoWhatsapp } from '../whatsapp/IconoWhatsapp'
import { IconoCorreo } from './iconos'

// Texto de la franja izquierda: el eslogan; sin eslogan, el mensaje de bienvenida (MSF-841). Si hay los dos y
// difieren, el eslogan va acá y la bienvenida sigue en su franja de la portada (`secciones/BarraBienvenida`).
export function textoBarra(contenido: { eslogan: string; bienvenida: string } | null): string {
  return contenido ? (contenido.eslogan.trim() || contenido.bienvenida.trim()) : ''
}

const estiloDato = { display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'inherit', textDecoration: 'none', '&:hover, &:focus-visible': { textDecoration: 'underline' } } as const

// Barra superior de la tienda (MSF-841, prototipo MJC_Home): 36 px, fondo `colorBarra` y texto blanco de 13 px;
// a la izquierda el eslogan y a la derecha WhatsApp y correo de la tienda. Un dato ausente no se muestra y sin
// nada que mostrar no hay barra (mientras carga el contacto se reserva su altura, sin saltos de diseño). En celular (MJC_M_Home) es una franja de 28 px con solo el eslogan, centrado.
export function BarraSuperior({ host }: { host: string }) {
  const contenido = useContenidoPublico(host)
  const contacto = useContactoTienda(host)
  const texto = textoBarra(contenido)
  const datos = contacto.fase === 'lista' ? contacto.contacto : null
  const whatsapp = datos?.whatsapp?.trim() || null
  const digitos = normalizarNumero(whatsapp)
  const correo = datos?.correo?.trim() || null
  // Mientras llega el contacto se reserva la altura de la barra (36 px / 28 px en celular) para que el encabezado no
  // salte al aparecer; si al final no hay nada que mostrar, la reserva desaparece.
  if (!texto && !whatsapp && !correo) {
    return contacto.fase === 'cargando' ? <Box data-testid="barra-superior-reserva" aria-hidden sx={{ height: { xs: 28, md: 36 } }} /> : null
  }

  return (
    <Box data-testid="barra-superior" sx={(tema) => ({ bgcolor: tema.tienda?.barra, color: tema.tienda?.textoBarra, fontSize: { xs: 12, md: 13 }, display: { xs: texto ? 'block' : 'none', md: 'block' } })}>
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, height: { xs: 28, md: 36 }, display: 'flex', alignItems: 'center', justifyContent: { xs: 'center', md: 'space-between' }, gap: 2 }}>
        {texto ? <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{texto}</Box> : <span />}
        {whatsapp || correo ? (
          <Box component="span" sx={{ display: { xs: 'none', md: 'inline-flex' }, alignItems: 'center', gap: '20px', flexShrink: 0 }}>
            {whatsapp ? (
              <Box component={digitos ? 'a' : 'span'} {...(digitos ? { href: `https://wa.me/${digitos}`, target: '_blank', rel: 'noopener noreferrer' } : {})} sx={estiloDato}>
                <IconoWhatsapp size={15} />{whatsapp}
              </Box>
            ) : null}
            {correo ? (
              <Box component="a" href={`mailto:${encodeURIComponent(correo)}`} sx={estiloDato}><IconoCorreo />{correo}</Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}
