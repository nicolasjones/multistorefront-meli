import { Link as RouterLink } from 'react-router'
import { Tab, Tabs } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'

// Pestañas «Stock actual · Movimientos · Ingreso de mercadería · Depósitos de mercadería» del
// prototipo (la última, F-STK-14) más «Carga en lote» (F-STK-10, no dibujada en el prototipo). La pestaña activa la decide quien la renderiza; cada una
// es un enlace real, así que funcionan con teclado y lector. «Faltantes» (F-STK-17, con prototipo en Ventas) va antes de «Actualizar por Excel» (F-STK-07), que va al final
// y solo se ofrece con `edicion` en Stock (la base es la autorización real).
export function PestanasStock({ activa }: { activa: 'stock' | 'movimientos' | 'ingresos' | 'depositos' | 'lote' | 'toma' | 'faltantes' | 'excel' }) {
  const { nivel } = useNivelSeccion('stock')
  return (
    <Tabs value={activa} aria-label="Secciones de Stock" variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
      <Tab value="stock" label="Stock actual" component={RouterLink} to="/stock" />
      <Tab value="movimientos" label="Movimientos" component={RouterLink} to="/stock/movimientos" />
      <Tab value="ingresos" label="Ingreso de mercadería" component={RouterLink} to="/stock/ingresos" />
      <Tab value="depositos" label="Depósitos de mercadería" component={RouterLink} to="/stock/depositos" />
      <Tab value="lote" label="Carga en lote" component={RouterLink} to="/stock/lote" />
      <Tab value="toma" label="Toma de inventario" component={RouterLink} to="/stock/toma-inventario" />
      <Tab value="faltantes" label="Faltantes" component={RouterLink} to="/stock/faltantes" />
      {nivel === 'edicion' && <Tab value="excel" label="Actualizar por Excel" component={RouterLink} to="/stock/excel" />}
    </Tabs>
  )
}
