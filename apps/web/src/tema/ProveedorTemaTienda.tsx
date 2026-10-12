import type { ReactNode } from 'react'
import { ThemeProvider } from '@mui/material'
import { useMemo } from 'react'
import { crearTemaTienda, type IdentidadTienda } from './temaTienda'

// ThemeProvider anidado: solo afecta a su subárbol, así el tema del panel
// (ThemeProvider de App.tsx) no se altera (FR-007).
export function ProveedorTemaTienda({
  identidad,
  children,
}: {
  identidad?: Partial<IdentidadTienda> | null
  children: ReactNode
}) {
  const tema = useMemo(() => crearTemaTienda(identidad), [identidad])
  return <ThemeProvider theme={tema}>{children}</ThemeProvider>
}
