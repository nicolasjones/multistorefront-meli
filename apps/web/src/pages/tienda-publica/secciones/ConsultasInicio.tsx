import { Box, Typography } from '@mui/material'
import type { ElementType, ReactNode } from 'react'
import { Link as EnlaceRuta } from 'react-router'
import { useContactoTienda } from '../../../hooks/useContactoTienda'
import { useFuenteTienda } from '../../../lib/fuenteTienda'
import { normalizarNumero } from '../../../lib/whatsapp'
import { IconoCorreo } from '../layout/iconos'
import type { PropsSeccionTienda } from '../PaginaTienda'
import { IconoWhatsapp } from '../whatsapp/IconoWhatsapp'

// Después de los destacados y antes del pie (MSF-841).
export const orden = 800

const estiloItem = { display: 'flex', alignItems: 'center', gap: '14px', color: 'inherit', textDecoration: 'none', minWidth: 0, '&:hover .consulta-valor, &:focus-visible .consulta-valor': { textDecoration: 'underline' } } as const

function Item({ icono, etiqueta, valor, componente, destino }: { icono: ReactNode; etiqueta: string; valor: string; componente: ElementType; destino: Record<string, unknown> }) {
  return (
    <Box component={componente} {...destino} sx={estiloItem}>
      <Box component="span" sx={{ width: 48, height: 48, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 /* estilos-sueltos: ok */ }}>{icono}</Box>
      <Box component="span" sx={{ minWidth: 0 }}>
        <Typography component="span" color="text.secondary" sx={{ display: 'block', fontSize: 13 /* estilos-sueltos: ok */ }}>{etiqueta}</Typography>
        <Typography component="span" className="consulta-valor" sx={{ display: 'block', fontSize: 18, fontWeight: 600, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>{valor}</Typography>
      </Box>
    </Box>
  )
}

// Bloque «Consultas por WhatsApp / Escribinos» del final de la portada (prototipo MJC_Home y SJ_Home): dos ítems con
// ícono. WhatsApp lleva el número de la tienda; «Escribinos» lleva a `/contacto` con el correo si lo hay. Sin número
// de WhatsApp queda solo «Escribinos». No se muestra en la vista previa del panel (no lee `publico.*`).
export default function ConsultasInicio({ host }: PropsSeccionTienda) {
  const enVistaPrevia = useFuenteTienda() !== null
  const estado = useContactoTienda(host, !enVistaPrevia)
  if (enVistaPrevia || estado.fase === 'cargando') return null
  const contacto = estado.fase === 'lista' ? estado.contacto : null
  const whatsapp = contacto?.whatsapp?.trim() || null
  const digitos = normalizarNumero(whatsapp)
  const correo = contacto?.correo?.trim() || null

  return (
    <Box component="section" aria-label="Consultas" data-testid="consultas-inicio" sx={(tema) => ({ bgcolor: tema.tienda?.superficie ?? 'action.hover', borderRadius: '8px', mt: 3 /* estilos-sueltos: ok */ })}>
      <Box sx={{ minHeight: 120, py: { xs: 3, md: 0 }, px: 2, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'center', gap: { xs: 3, md: '120px' } /* estilos-sueltos: ok */ }}>
        {whatsapp && digitos ? (
          <Item componente="a" destino={{ href: `https://wa.me/${digitos}`, target: '_blank', rel: 'noopener noreferrer' }} icono={<IconoWhatsapp size={24} />} etiqueta="Consultas por WhatsApp" valor={whatsapp} />
        ) : null}
        <Item componente={EnlaceRuta} destino={{ to: '/contacto' }} icono={<IconoCorreo size={24} />} etiqueta="Escribinos" valor={correo ?? 'Dejanos tu consulta'} />
      </Box>
    </Box>
  )
}
