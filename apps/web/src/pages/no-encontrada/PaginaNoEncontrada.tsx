import { Button } from '@mui/material'
import { Link } from 'react-router'
import { EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'

// MSF-636: reemplaza el ErrorComponent de Refine («Sorry, the page you visited does not exist»)
// para toda ruta inexistente dentro del panel.
export function PaginaNoEncontrada() {
  return (
    <>
      <EncabezadoPagina titulo="No encontramos esta página" />
      <ContenedorSeccion>
        <EstadoVacio
          titulo="Esta página no existe"
          descripcion="La dirección que abriste no corresponde a ninguna sección del panel. Revisá el enlace o volvé al inicio."
          accion={<Button color="inherit" component={Link} to="/">Volver al inicio</Button>}
        />
      </ContenedorSeccion>
    </>
  )
}
