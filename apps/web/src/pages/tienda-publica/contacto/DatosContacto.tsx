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

// Bloques «WhatsApp» (número y horarios) y «Correo» (F-TDA-16, FR-009). El bloque o la línea sin dato no se
// muestra (sin hueco ni texto inventado). Todo texto va como nodo de React: se escapa solo.
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
        </Bloque>
      ) : null}
    </Box>
  )
}
