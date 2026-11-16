import { Box, Typography } from '@mui/material'
import { cuitParaMostrar, legalTieneDatos, useLegalTienda } from '../../../lib/tiendaLegal'
import type { LegalTienda } from '../../../lib/tiendaLegal'
import { urlHttpSegura } from '../../../lib/urlHttpSegura'

// Bloque legal del pie (F-TDA-22, FR-032): «<Razón social> · CUIT …», dirección y enlaces legales de la empresa
// dueña de la tienda. Cada dato ausente se omite y sin ningún dato el bloque no aparece. Todo es texto (React
// lo escapa); los enlaces se abren en pestaña nueva y la lista ya viene filtrada a `https`.
export function BloqueLegal({ legal }: { legal: LegalTienda | null }) {
  if (!legalTieneDatos(legal)) {
    return null
  }
  const cuit = cuitParaMostrar(legal.cuit)
  // Solo http(s): un enlace que no lo sea no se muestra (defensa en profundidad; el servidor ya filtra).
  const enlaces = legal.enlaces.flatMap((enlace) => {
    const href = urlHttpSegura(enlace.url)
    return href ? [{ ...enlace, href }] : []
  })
  const identidad = [legal.razonSocial, cuit ? `CUIT ${cuit}` : null].filter((parte): parte is string => parte !== null).join(' · ')

  return (
    <Box component="section" aria-label="Información legal" data-testid="pie-legal" sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(255,255,255,.15)' /* estilos-sueltos: ok */ }}>
      {identidad ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{identidad}</Typography> : null}
      {legal.direccion ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{legal.direccion}</Typography> : null}
      {enlaces.length > 0 ? (
        <Box component="ul" aria-label="Enlaces legales" sx={{ listStyle: 'none', m: 0, mt: 1, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 3 }}>
          {enlaces.map((enlace) => (
            <li key={`${enlace.titulo}|${enlace.url}`}>
              <Box component="a" href={enlace.href} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', display: 'inline-block', py: 0.5, overflowWrap: 'anywhere' }}>
                {enlace.titulo}
              </Box>
            </li>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

export function PieLegal({ host }: { host: string }) {
  return <BloqueLegal legal={useLegalTienda(host)} />
}
