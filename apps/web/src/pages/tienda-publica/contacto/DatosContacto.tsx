import { Box, Typography } from '@mui/material'
import type { ContactoTienda } from '../../../lib/tiendaContacto'
import { IconoCorreo, IconoLocal } from '../layout/iconos'
import { IconoWhatsapp } from '../whatsapp/IconoWhatsapp'
import { LINEA_SUAVE } from '../layout/medidas'

// Bloque de contacto del prototipo (`MJC_Contacto`): círculo de 44 px en el color primario con el glifo en blanco a la
// izquierda; a su lado el rótulo (13 px, gris), el dato (18 px/600) y la nota (14 px, gris). Cada bloque lleva una línea
// inferior y 16 px de aire arriba y abajo. El rótulo es el encabezado del bloque (h2) para los lectores de pantalla.
function Bloque({ titulo, icono, children, testId }: { titulo: string; icono: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <Box component="section" aria-label={titulo} data-testid={testId} sx={{ display: 'flex', gap: '14px', alignItems: 'flex-start', py: '16px', borderBottom: LINEA_SUAVE, minWidth: 0 /* estilos-sueltos: ok */ }}>
      <Box component="span" aria-hidden sx={{ width: { xs: 40, md: 44 }, height: { xs: 40, md: 44 }, borderRadius: '50%', bgcolor: 'primary.main', color: 'primary.contrastText', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 /* estilos-sueltos: ok */ }}>{icono}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h2" color="text.secondary" sx={{ fontSize: 13, fontWeight: 400, fontFamily: 'inherit' /* estilos-sueltos: ok */ }}>{titulo}</Typography>
        {children}
      </Box>
    </Box>
  )
}

const estiloDato = { fontSize: { xs: 16, md: 18 }, fontWeight: 600, overflowWrap: 'anywhere' } as const // estilos-sueltos: ok
const estiloNota = { fontSize: 14, mt: '2px', overflowWrap: 'anywhere' } as const // estilos-sueltos: ok

// Bloques «WhatsApp» (número y horarios), «Correo» (con el aviso de respuesta) y «Retiro y envíos» (F-TDA-16,
// FR-009; MSF-825/MSF-831, MJC_Contacto). El bloque o la línea sin dato no se muestra (sin hueco ni texto
// inventado): «Retiro y envíos» dice por qué medio se coordina según los datos que la tienda cargó. Todo texto
// va como nodo de React: se escapa solo.
export function DatosContacto({ contacto }: { contacto: ContactoTienda }) {
  if (!contacto.whatsapp && !contacto.correo) return null
  return (
    <Box data-testid="datos-contacto">
      {contacto.whatsapp ? (
        <Bloque titulo="WhatsApp" icono={<IconoWhatsapp size={22} />} testId="bloque-whatsapp">
          <Typography sx={estiloDato}>{contacto.whatsapp}</Typography>
          {contacto.horarios ? <Typography color="text.secondary" sx={estiloNota}>{contacto.horarios}</Typography> : null}
        </Bloque>
      ) : null}
      {contacto.correo ? (
        <Bloque titulo="Correo" icono={<IconoCorreo size={22} />} testId="bloque-correo">
          <Typography sx={estiloDato}>{contacto.correo}</Typography>
          <Typography color="text.secondary" sx={estiloNota}>Respondemos dentro de las 24 h</Typography>
        </Bloque>
      ) : null}
      <Bloque titulo="Retiro y envíos" icono={<IconoLocal />} testId="bloque-retiro-envios">
        <Typography sx={estiloDato}>{contacto.whatsapp ? 'Coordinamos por WhatsApp' : 'Coordinamos por correo'}</Typography>
        <Typography color="text.secondary" sx={estiloNota}>No hay compra online en esta versión: consultás y coordinamos.</Typography>
      </Bloque>
    </Box>
  )
}
