import type { ReactNode } from 'react'
import { Button } from '@mui/material'
import { Link } from 'react-router'
import { usePuedeEscribir } from '../hooks/usePuedeEscribir'
import { ContenedorSeccion } from './pagina/ContenedorSeccion'
import { EncabezadoPagina } from './pagina/EncabezadoPagina'
import { EstadoCargaPagina, EstadoVacio } from './estados/EstadosPagina'

// Pantallas solo de administradores (p. ej. la importación del historial): quien no lo es ve el motivo en lugar de la
// pantalla, y los hijos no se montan. Es defensa de UX: la autorización real la hace cada RPC y RLS.
export function RequiereAdministrador({ children, seccion }: { children: ReactNode; seccion: string }) {
  const { puedeEscribir, isLoading } = usePuedeEscribir()
  if (isLoading || puedeEscribir === null) return <EstadoCargaPagina />
  if (!puedeEscribir) {
    return (
      <>
        <EncabezadoPagina titulo={seccion} />
        <ContenedorSeccion>
          <EstadoVacio
            titulo="Solo para administradores"
            descripcion={`${seccion} solo está disponible para administradores de la organización.`}
            accion={<Button color="inherit" component={Link} to="/">Volver al inicio</Button>}
          />
        </ContenedorSeccion>
      </>
    )
  }
  return <>{children}</>
}
