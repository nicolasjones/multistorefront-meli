import { Link as RouterLink } from 'react-router'
import { Box, Button } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { PestanasService } from '../../components/service/PestanasService'

// Service técnico · Reparaciones (F-SVC-02, FR-018). Esta historia entrega el alta: la pestaña ofrece «Nueva
// reparación», que lleva al detalle recién creado. La tabla, los KPIs y los filtros del prototipo son de MSF-199.
export function ServicioReparaciones() {
  const { nivel } = useNivelSeccion('service_tecnico')
  const puedeEditar = nivel === 'edicion'
  return (
    <Box>
      <EncabezadoPagina
        titulo="Reparaciones"
        descripcion="Equipos que ingresan al taller, con su cliente, técnico y fechas."
        accion={
          puedeEditar ? (
            <Button variant="contained" component={RouterLink} to="/service-tecnico/reparaciones/nueva">
              Nueva reparación
            </Button>
          ) : undefined
        }
        contexto={<ContextoOrganizacionActiva />}
        pestanas={<PestanasService activa="reparaciones" />}
      />
      <ContenedorSeccion>
        <EstadoVacio
          titulo="Cargá una reparación con «Nueva reparación»."
          descripcion={
            puedeEditar
              ? 'Al guardarla vas a ver su detalle. El listado con filtros llega en una próxima entrega.'
              : 'Tu rol puede consultar reparaciones, pero no crearlas. El listado con filtros llega en una próxima entrega.'
          }
        />
      </ContenedorSeccion>
    </Box>
  )
}
