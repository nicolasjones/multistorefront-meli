import { useEffect } from 'react'
import { Box, Typography } from '@mui/material'
import { ProveedorTemaTienda } from '../../tema/ProveedorTemaTienda'
import { contrasteBlancoSobre, familiasACargar, urlFuentes, urlPublica } from '../../lib/tiendaIdentidad'
import type { MarcaTiendaPausada } from '../../lib/tiendaEstado'

const TEXTO_OSCURO = '#1A1A1A'
const TEXTO_CLARO = '#FFFFFF'

// Texto legible sobre el fondo de la tienda: blanco si el fondo es oscuro (el texto blanco alcanza AA).
function colorTextoSobre(fondo: string): string {
  const contraste = contrasteBlancoSobre(fondo)
  return contraste !== null && contraste >= 4.5 ? TEXTO_CLARO : TEXTO_OSCURO
}

// «Volvemos pronto» (F-TDA-01 FR-003, F-TDA-19 FR-002). Con `marca` (tienda desactivada, D1) muestra el
// logo, el nombre comercial, los colores y las tipografías de la tienda; sin `marca` (dominio
// desconocido) es la versión genérica, que no revela si el dominio existe. Nunca enlaza al catálogo ni
// muestra contacto.
export function VolvemosPronto({ marca }: { marca?: MarcaTiendaPausada }) {
  const url = marca ? urlFuentes(familiasACargar(marca)) : null

  useEffect(() => {
    if (!url) return undefined
    const enlace = document.createElement('link')
    enlace.rel = 'stylesheet'
    enlace.href = url
    enlace.setAttribute('data-tienda-fuentes', '')
    document.head.appendChild(enlace)
    return () => enlace.remove()
  }, [url])

  const logo = marca ? urlPublica(marca.logoRuta) : null
  const contenido = (
    <Box
      component="main"
      data-testid={marca ? 'volvemos-pronto-marca' : 'volvemos-pronto-generica'}
      sx={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2,
        ...(marca ? { bgcolor: 'background.default', color: 'text.primary' } : {}),
      }}
    >
      {marca ? (
        <>
          {logo ? <Box component="img" src={logo} alt="" sx={{ display: 'block', height: (tema) => tema.spacing(8), maxWidth: '100%', objectFit: 'contain', mb: 2 }} /> : null}
          <Typography component="p" variant="h5" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{marca.nombre}</Typography>
        </>
      ) : null}
      <Typography component="h1" variant="h4" sx={{ mb: 1 }}>Volvemos pronto</Typography>
      <Typography color={marca ? 'inherit' : 'text.secondary'}>Estamos preparando esta tienda. Volvé a visitarnos en un rato.</Typography>
    </Box>
  )

  if (!marca) return contenido
  return (
    <ProveedorTemaTienda
      identidad={{
        tipografiaTitulos: marca.tipografiaTitulos,
        tipografiaTexto: marca.tipografiaTexto,
        colorPrimario: marca.colorPrimario,
        colorFondo: marca.colorFondo,
        colorTexto: colorTextoSobre(marca.colorFondo),
      }}
    >
      {contenido}
    </ProveedorTemaTienda>
  )
}
