import { Link as RouterLink } from 'react-router'
import { Tab, Tabs } from '@mui/material'

// Pestañas «Stock actual · Movimientos · Ingreso de mercadería» del prototipo. La
// pestaña activa la decide quien la renderiza; cada una es un enlace real, así que
// funcionan con teclado y lector.
export function PestanasStock({ activa }: { activa: 'stock' | 'movimientos' | 'ingresos' }) {
  return (
    <Tabs value={activa} aria-label="Secciones de Stock" variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
      <Tab value="stock" label="Stock actual" component={RouterLink} to="/stock" />
      <Tab value="movimientos" label="Movimientos" component={RouterLink} to="/stock/movimientos" />
      <Tab value="ingresos" label="Ingreso de mercadería" component={RouterLink} to="/stock/ingresos" />
    </Tabs>
  )
}
