import { Link as RouterLink } from 'react-router'
import { Tab, Tabs } from '@mui/material'

// «Nueva campaña · Historial» de Correo masivo. Son enlaces reales (teclado y lector). «Nueva campaña» solo se ofrece
// con edición en Clientes; el Historial es de lectura (FR-034). La base es la autorización real.
export function PestanasCorreoMasivo({ activa, puedeCrear }: { activa: 'nueva' | 'historial'; puedeCrear: boolean }) {
  return (
    <Tabs value={activa} aria-label="Secciones de Correo masivo" variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
      {puedeCrear ? <Tab value="nueva" label="Nueva campaña" component={RouterLink} to="/clientes/correo-masivo" /> : null}
      <Tab value="historial" label="Historial" component={RouterLink} to="/clientes/correo-masivo/historial" />
    </Tabs>
  )
}
