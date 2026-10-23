import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { ProveedorTemaTienda } from '../../../tema/ProveedorTemaTienda'
import { familiasACargar, resolverIdentidadPublica, urlFuentes, urlPublica, type IdentidadTienda } from '../../../lib/tiendaIdentidad'
import type { PropsSeccionTienda } from '../PaginaTienda'

// F-TDA-02 (FR-030): identidad visual de la tienda pública. Lee `publico.identidad_por_dominio(host)`
// (solo la de la tienda de ese dominio), aplica colores y tipografías como variables de tema
// (`--tienda-*`, para que las demás secciones las usen) y muestra logo y banners en la home. Si la
// identidad no se puede leer, la tienda sigue con el tema base: nunca se rompe por esto.

// Antes de las secciones de contenido y catálogo.
export const orden = 10

const VARIABLES = {
  '--tienda-color-primario': 'colorPrimario',
  '--tienda-color-primario-oscuro': 'colorPrimarioOscuro',
  '--tienda-color-acento': 'colorAcento',
  '--tienda-color-fondo': 'colorFondo',
} as const satisfies Record<string, keyof IdentidadTienda>

function aplicarVariables(identidad: IdentidadTienda): () => void {
  const raiz = document.documentElement
  const cuerpo = document.body
  for (const [variable, clave] of Object.entries(VARIABLES)) {
    raiz.style.setProperty(variable, String(identidad[clave as keyof IdentidadTienda]))
  }
  raiz.style.setProperty('--tienda-fuente-titulos', `"${identidad.tipografiaTitulos}", system-ui, sans-serif`)
  raiz.style.setProperty('--tienda-fuente-texto', `"${identidad.tipografiaTexto}", system-ui, sans-serif`)
  const fondoAnterior = cuerpo.style.backgroundColor
  cuerpo.style.backgroundColor = identidad.colorFondo

  const url = urlFuentes(familiasACargar(identidad))
  let enlace: HTMLLinkElement | null = null
  if (url) {
    enlace = document.createElement('link')
    enlace.rel = 'stylesheet'
    enlace.href = url
    enlace.setAttribute('data-tienda-fuentes', '')
    document.head.appendChild(enlace)
  }
  return () => {
    for (const variable of [...Object.keys(VARIABLES), '--tienda-fuente-titulos', '--tienda-fuente-texto']) {
      raiz.style.removeProperty(variable)
    }
    cuerpo.style.backgroundColor = fondoAnterior
    enlace?.remove()
  }
}

export default function TemaTienda({ tienda, host }: PropsSeccionTienda) {
  const [identidad, setIdentidad] = useState<IdentidadTienda | null>(null)

  useEffect(() => {
    let cancelada = false
    setIdentidad(null)
    resolverIdentidadPublica(host)
      .then((resultado) => { if (!cancelada) setIdentidad(resultado) })
      .catch((error) => console.error('No se pudo leer la identidad de la tienda', error instanceof Error ? error.message : error))
    return () => { cancelada = true }
  }, [host])

  useEffect(() => (identidad ? aplicarVariables(identidad) : undefined), [identidad])

  if (!identidad) return null
  const logo = urlPublica(identidad.logoRuta)
  const banner = urlPublica(identidad.bannerRuta)
  const bannerMovil = urlPublica(identidad.bannerMovilRuta)

  return (
    <ProveedorTemaTienda
      identidad={{
        tipografiaTitulos: identidad.tipografiaTitulos,
        tipografiaTexto: identidad.tipografiaTexto,
        colorPrimario: identidad.colorPrimario,
        colorFondo: identidad.colorFondo,
      }}
    >
      <Box data-testid="tema-tienda" sx={{ mb: 2 }}>
        {logo ? <Box component="img" src={logo} alt={`Logo de ${tienda.empresaNombre}`} sx={{ display: 'block', height: (tema) => tema.spacing(6), maxWidth: '100%', objectFit: 'contain', mb: 2 }} /> : null}
        {banner ? (
          <Box component="picture" sx={{ display: 'block' }}>
            {bannerMovil ? <source media="(max-width: 600px)" srcSet={bannerMovil} /> : null}
            <Box component="img" src={banner} alt="" sx={{ display: 'block', width: '100%', height: 'auto', borderRadius: (tema) => tema.shape.borderRadius }} />
          </Box>
        ) : null}
      </Box>
    </ProveedorTemaTienda>
  )
}
