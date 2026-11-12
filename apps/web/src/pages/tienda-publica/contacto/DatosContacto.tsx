import { Box, Typography } from '@mui/material'
import type { ContactoTienda } from '../../../lib/tiendaContacto'

function Bloque({ titulo, children, testId }: { titulo: string; children: React.ReactNode; testId: string }) {
  return (
    <Box component="section" aria-label={titulo} data-testid={testId} sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>{titulo}</Typography>
      {children}
    </Box>
  )
}

// Bloques «WhatsApp» (número y horarios), «Correo» (con el aviso de respuesta) y «Retiro y envíos» (F-TDA-16,
// FR-009; MSF-825/MSF-831, MJC_Contacto). El bloque o la línea sin dato no se muestra (sin hueco ni texto
// inventado): «Retiro y envíos» dice por qué medio se coordina según los datos que la tienda cargó. Todo texto
// va como nodo de React: se escapa solo.
export function DatosContacto({ contacto }: { contacto: ContactoTienda }) {
  if (!contacto.whatsapp && !contacto.correo) return null
  return (
    <Box data-testid="datos-contacto">
      {contacto.whatsapp ? (
        <Bloque titulo="WhatsApp" testId="bloque-whatsapp">
          <Typography sx={{ overflowWrap: 'anywhere' }}>{contacto.whatsapp}</Typography>
          {contacto.horarios ? <Typography color="text.secondary" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{contacto.horarios}</Typography> : null}
        </Bloque>
      ) : null}
      {contacto.correo ? (
        <Bloque titulo="Correo" testId="bloque-correo">
          <Typography sx={{ overflowWrap: 'anywhere' }}>{contacto.correo}</Typography>
          <Typography color="text.secondary" variant="body2">Respondemos dentro de las 24 h</Typography>
        </Bloque>
      ) : null}
      <Bloque titulo="Retiro y envíos" testId="bloque-retiro-envios">
        <Typography>{contacto.whatsapp ? 'Coordinamos por WhatsApp' : 'Coordinamos por correo'}</Typography>
        <Typography color="text.secondary" variant="body2">No hay compra online en esta versión: consultás y coordinamos.</Typography>
      </Bloque>
    </Box>
  )
}
