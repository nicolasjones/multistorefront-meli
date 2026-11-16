import { Link as RouterLink } from 'react-router'
import { Tab, Tabs } from '@mui/material'

// Pestañas de la ficha de empresa que existen hoy: «General» y «Precios y moneda» (F-PRE-07).
// Las demás del prototipo (Mercado Libre, Identidad visual…) llegan con sus propias historias.
// Cada pestaña es un enlace real: funciona con teclado y lector de pantalla.
export function PestanasEmpresa({ empresaId, activa }: { empresaId: string; activa: 'general' | 'precios' }) {
  return (
    <Tabs value={activa} aria-label="Secciones de la empresa" variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
      <Tab value="general" label="General" component={RouterLink} to={`/empresas/edit/${empresaId}`} />
      <Tab value="precios" label="Precios y moneda" component={RouterLink} to={`/empresas/edit/${empresaId}/precios`} />
    </Tabs>
  )
}
