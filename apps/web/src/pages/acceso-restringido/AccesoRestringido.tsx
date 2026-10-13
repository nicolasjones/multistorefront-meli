import { Button } from '@mui/material'
import { Link } from 'react-router'
import { EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'

type AccesoRestringidoProps = {
  // Nombre visible del rol y de la sección (no identificadores técnicos).
  rol: string
  seccion: string
}

// F-ROL-03 (FR-008): se muestra en lugar de la sección denegada. Es
// presentacional: no carga datos de la sección. «Solicitar acceso» queda
// fuera de alcance (decisión del orquestador); la persona pide el acceso a
// un administrador, como indica el texto.
export function AccesoRestringido({ rol, seccion }: AccesoRestringidoProps) {
  return (
    <>
      <EncabezadoPagina titulo="No tenés acceso a esta sección" />
      <ContenedorSeccion>
        <EstadoVacio
          titulo="Acceso restringido"
          descripcion={`Tu rol (${rol}) no incluye ${seccion}. Pedile acceso a un administrador.`}
          accion={<Button color="inherit" component={Link} to="/">Volver al inicio</Button>}
        />
      </ContenedorSeccion>
    </>
  )
}
