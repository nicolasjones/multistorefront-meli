import { Link as RouterLink } from 'react-router'
import { Tab, Tabs } from '@mui/material'

// La pantalla Reparaciones (alta y detalle) la entrega F-SVC-02: hasta entonces la pestaña se ve, como en el
// prototipo, pero no navega. F-SVC-02 pone esta constante en `true` junto con su ruta.
export const REPARACIONES_DISPONIBLES = false

export type PestanaService = 'reparaciones' | 'modelos' | 'estados'

// Tira «Reparaciones · Modelos · Estados de reparación» del prototipo (FR-009). La pestaña activa la decide
// quien la renderiza; cada una disponible es un enlace real, así que funciona con teclado y lector de pantalla.
export function PestanasService({ activa }: { activa: PestanaService }) {
  return (
    <Tabs value={activa} aria-label="Secciones de Service técnico" variant="scrollable" scrollButtons="auto">
      <Tab
        value="reparaciones"
        label="Reparaciones"
        {...(REPARACIONES_DISPONIBLES
          ? { component: RouterLink, to: '/service-tecnico/reparaciones' }
          : { disabled: true })}
      />
      <Tab value="modelos" label="Modelos" component={RouterLink} to="/service-tecnico/modelos" />
      <Tab value="estados" label="Estados de reparación" component={RouterLink} to="/service-tecnico/estados" />
    </Tabs>
  )
}
