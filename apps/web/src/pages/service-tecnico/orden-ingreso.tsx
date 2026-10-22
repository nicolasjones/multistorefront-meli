import { Link as RouterLink, useParams } from 'react-router'
import { Box, Link, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { DocumentoA4 } from '../../components/service/DocumentoA4'
import { useDocumentoReparacion } from '../../components/service/useDocumentoReparacion'
import { armarOrdenIngreso } from '../../lib/documentosReparacion'

// Orden de ingreso imprimible (F-SVC-07, FR-040): sin importes. El acceso (`lectura` en `service_tecnico`) lo exige
// la ruta con RequiereServiceTecnico («Acceso restringido» si falta); la visibilidad por tienda, la base.
export function ServicioOrdenIngreso() {
  const { id } = useParams()
  const { datos, error, cargando, reintentar } = useDocumentoReparacion(id)
  const volver = (
    <Link component={RouterLink} to={id ? `/service-tecnico/reparaciones/${id}` : '/service-tecnico/reparaciones'} underline="hover">
      ← Volver a la reparación
    </Link>
  )
  if (cargando) return <EstadoCargaPagina />
  if (error || !datos) return <EstadoError descripcion={error ?? 'No pudimos cargar la reparación.'} reintentar={reintentar} />

  const orden = armarOrdenIngreso(datos.reparacion, datos.tienda, datos.tecnico)
  return (
    <DocumentoA4 titulo={orden.titulo} numero={orden.numero} tienda={orden.tienda} volver={volver}>
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 3, rowGap: 1 }}>
        {orden.filas.map((fila) => (
          <Box key={fila.etiqueta} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" sx={{ fontWeight: 700 }}>{fila.etiqueta}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>{fila.valor}</Typography>
          </Box>
        ))}
      </Box>
      <Typography component="p" variant="body2" sx={{ mt: 3 }}>{orden.condiciones}</Typography>
    </DocumentoA4>
  )
}
