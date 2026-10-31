import { Link as RouterLink } from 'react-router'
import { Tab, Tabs } from '@mui/material'

export type PestanaService = 'reparaciones' | 'modelos' | 'estados' | 'reportes'

// Tira «Reparaciones · Modelos · Estados de reparación» del prototipo (FR-009) más «Reportes» (F-SVC-23, FR-064). La pestaña activa la decide
// quien la renderiza; cada una disponible es un enlace real, así que funciona con teclado y lector de pantalla.
export function PestanasService({ activa }: { activa: PestanaService }) {
  return (
    <Tabs value={activa} aria-label="Secciones de Servicio técnico" variant="scrollable" scrollButtons="auto">
      <Tab value="reparaciones" label="Reparaciones" component={RouterLink} to="/service-tecnico/reparaciones" />
      <Tab value="modelos" label="Modelos" component={RouterLink} to="/service-tecnico/modelos" />
      <Tab value="estados" label="Estados de reparación" component={RouterLink} to="/service-tecnico/estados" />
      <Tab value="reportes" label="Reportes" component={RouterLink} to="/service-tecnico/reportes" />
    </Tabs>
  )
}
