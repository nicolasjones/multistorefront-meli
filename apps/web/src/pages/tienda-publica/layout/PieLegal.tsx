import { Box, Typography } from '@mui/material'
import { cuitParaMostrar, legalTieneDatos, useLegalTienda } from '../../../lib/tiendaLegal'
import type { LegalTienda } from '../../../lib/tiendaLegal'

// Bloque legal del pie (F-TDA-22, FR-032): «<Razón social> · CUIT …», dirección y enlaces legales de la empresa
// dueña de la tienda. Cada dato ausente se omite y sin ningún dato el bloque no aparece. Todo es texto (React
// lo escapa); los enlaces se abren en pestaña nueva y la lista ya viene filtrada a `https`.
export function BloqueLegal({ legal }: { legal: LegalTienda | null }) {
  if (!legalTieneDatos(legal)) {
    return null
  }
  const cuit = cuitParaMostrar(legal.cuit)
  const identidad = [legal.razonSocial, cuit ? `CUIT ${cuit}` : null].filter((parte): parte is string => parte !== null).join(' · ')

  return (
    <Box component="section" aria-label="Información legal" data-testid="pie-legal" sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      {identidad ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{identidad}</Typography> : null}
      {legal.direccion ? <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{legal.direccion}</Typography> : null}
      {legal.enlaces.length > 0 ? (
        <Box component="ul" aria-label="Enlaces legales" sx={{ listStyle: 'none', m: 0, mt: 1, p: 0, display: 'flex', flexWrap: 'wrap', columnGap: 3 }}>
          {legal.enlaces.map((enlace) => (
            <li key={`${enlace.titulo}|${enlace.url}`}>
              <Box component="a" href={enlace.url} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', display: 'inline-block', py: 0.5, overflowWrap: 'anywhere' }}>
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
