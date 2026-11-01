import { Button } from '@mui/material'
import { Link } from 'react-router'
import { EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'

// Ruta inexistente (MSF-636): reemplaza la pantalla 404 en inglés de la librería por una del sistema,
// con los mismos componentes de estado que «No tenés acceso a esta sección».
export function NoEncontrada() {
  return (
    <>
      <EncabezadoPagina titulo="No encontramos esta página" />
      <ContenedorSeccion>
        <EstadoVacio
          titulo="La página que buscás no existe"
          descripcion="Puede que la dirección esté mal escrita o que la página se haya movido."
          accion={<Button color="inherit" component={Link} to="/">Volver al inicio</Button>}
        />
      </ContenedorSeccion>
    </>
  )
}
