import { Box, Typography } from '@mui/material'
import { lazy, Suspense } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { useContactoTienda } from '../../../hooks/useContactoTienda'
import { useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { categoriasPrincipales, type CategoriaPublica } from '../../../lib/tiendaCategorias'
import { urlPublica } from '../../../lib/tiendaIdentidad'
import { normalizarNumero } from '../../../lib/whatsapp'
import { estiloEnlacePie, estiloTituloPie } from './estilosPie'
import { useIdentidadTienda } from './IdentidadTiendaContexto'
import { PieInformacion } from './PieInformacion'
import { PieLegal } from './PieLegal'

// Aviso de cookies (F-TDA-22): carga diferida, no pesa en el primer pintado.
const AvisoCookies = lazy(() => import('./AvisoCookies'))


// Pie oscuro de la tienda (F-TDA-11, FR-005; MSF-841, prototipo MJC_Home): fondo `colorBarra` y texto blanco. Trae el
// logo (en blanco) y el eslogan, el texto del pie configurado, la columna «Categorías» (las mismas principales que el menú,
// FR-005; sin categorías visibles no se muestra), la columna «Información» con las páginas de contenido (F-TDA-23), la
// columna «Contacto» (WhatsApp, correo y el enlace «Escribinos» a `/contacto` (F-TDA-16, FR-010), que está siempre), el
// bloque legal de la empresa (F-TDA-22, FR-032) y la línea «© año empresa». Monta el aviso de cookies (FR-033).
export function PieCategorias({ categorias: todas, host, empresaNombre }: { categorias: CategoriaPublica[]; host: string; empresaNombre: string }) {
  // MSF-825: las mismas categorías principales que el menú (FR-005), no las ~190 de la base.
  const categorias = categoriasPrincipales(todas)
  const logo = urlPublica(useIdentidadTienda()?.logoRuta ?? null)
  const contenido = useContenidoPublico(host)
  const contactoEstado = useContactoTienda(host)
  const contacto = contactoEstado.fase === 'lista' ? contactoEstado.contacto : null
  const whatsapp = contacto?.whatsapp?.trim() || null
  const digitos = normalizarNumero(whatsapp)
  const correo = contacto?.correo?.trim() || null
  const eslogan = contenido?.eslogan.trim() ?? ''
  const textoPie = contenido?.pie.trim() ?? ''

  return (
    <>
    <Box component="footer" data-testid="pie-tienda-layout" sx={(tema) => ({ bgcolor: tema.tienda?.barra, color: tema.tienda?.textoBarra })}>
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, pt: 5, pb: 4 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: { xs: 3, md: 6 } }}>
          <Box sx={{ maxWidth: 340, minWidth: 0 }}>
            {logo ? (
              <Box component="img" src={logo} alt={empresaNombre} sx={{ display: 'block', height: 44, width: 'auto', maxWidth: '100%', filter: 'brightness(0) invert(1)' /* estilos-sueltos: ok */ }} />
            ) : (
              <Typography component="p" sx={{ fontWeight: 700, fontSize: 20, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>{empresaNombre}</Typography>
            )}
            {eslogan ? <Typography sx={{ mt: 1.5, fontSize: 14, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>{eslogan}</Typography> : null}
            {textoPie ? <Typography data-testid="pie-tienda" sx={{ mt: 1.5, fontSize: 14, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>{textoPie}</Typography> : null}
          </Box>
          {categorias.length > 0 ? (
            <Box component="nav" aria-label="Categorías del pie" data-testid="pie-categorias">
              <Typography component="h2" sx={estiloTituloPie}>Categorías</Typography>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, fontSize: 14 /* estilos-sueltos: ok */ }}>
                {categorias.map((categoria) => (
                  <li key={categoria.id}>
                    <Box component={EnlaceRuta} to={`/categoria/${categoria.id}`} sx={estiloEnlacePie}>{categoria.nombre}</Box>
                  </li>
                ))}
              </Box>
            </Box>
          ) : null}
          {host ? <PieInformacion host={host} /> : null}
          <Box component="nav" aria-label="Contacto del pie" data-testid="pie-contacto">
            <Typography component="h2" sx={estiloTituloPie}>Contacto</Typography>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, fontSize: 14 /* estilos-sueltos: ok */ }}>
              {whatsapp ? (
                <li>
                  <Box component={digitos ? 'a' : 'span'} {...(digitos ? { href: `https://wa.me/${digitos}`, target: '_blank', rel: 'noopener noreferrer' } : {})} sx={estiloEnlacePie}>{whatsapp}</Box>
                </li>
              ) : null}
              {correo ? <li><Box component="a" href={`mailto:${encodeURIComponent(correo)}`} sx={estiloEnlacePie}>{correo}</Box></li> : null}
              <li><Box component={EnlaceRuta} to="/contacto" sx={{ ...estiloEnlacePie, textDecoration: 'underline' }}>Escribinos</Box></li>
            </Box>
          </Box>
        </Box>
        <PieLegal host={host} />
      </Box>
      <Box sx={{ borderTop: '1px solid rgba(255,255,255,.15)' /* estilos-sueltos: ok */ }}>
        <Typography sx={{ maxWidth: 1200, mx: 'auto', px: 2, py: '14px', fontSize: 12, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>
          © {new Date().getFullYear()} {empresaNombre}. Todos los derechos reservados.
        </Typography>
      </Box>
    </Box>
    <Suspense fallback={null}>
      <AvisoCookies />
    </Suspense>
    </>
  )
}
