import { useState } from 'react'
import { Alert, Box, Divider } from '@mui/material'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { IngresoMercaderiaForm } from '../../components/stock/IngresoMercaderiaForm'
import { HistorialIngresos } from '../../components/stock/HistorialIngresos'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { PestanasStock } from './PestanasStock'

// F-PRV-04/F-PRV-05: pestaña «Ingreso de mercadería» dentro de Stock. El formulario
// se oculta con solo lectura; el historial queda visible (RLS es la autorización real).
export function IngresosMercaderia() {
  const [revision, setRevision] = useState(0)
  const { nivel, isLoading } = useNivelSeccion('stock')

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="ingresos" />
        {isLoading ? <EstadoCargaPagina /> : nivel === 'edicion' ? (
          <IngresoMercaderiaForm onRegistrado={() => setRevision((valor) => valor + 1)} />
        ) : (
          <Alert severity="info">Tu rol puede ver el historial, pero no registrar ingresos de mercadería.</Alert>
        )}
        <Divider sx={{ my: 3 }} />
        <HistorialIngresos revision={revision} />
      </ContenedorSeccion>
    </Box>
  )
}
