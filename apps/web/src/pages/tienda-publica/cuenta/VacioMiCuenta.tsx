import { Button } from '@mui/material'
import { Link as EnlaceRuta } from 'react-router'
import { EstadoVacio } from '../../../components/estados/EstadosPagina'

// Vacío de una sección de «Mi cuenta» (F-CLI-20, P-3): título, descripción y la salida clara «Ver catálogo».
export function VacioMiCuenta({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <EstadoVacio
      titulo={titulo}
      descripcion={descripcion}
      accion={<Button component={EnlaceRuta} to="/catalogo" color="inherit" sx={{ minHeight: (tema) => tema.spacing(5.5) }}>Ver catálogo</Button>}
    />
  )
}
