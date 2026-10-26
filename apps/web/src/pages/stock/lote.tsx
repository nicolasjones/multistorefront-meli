import { useState } from 'react'
import { Alert, Box, Divider } from '@mui/material'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { LoteStockForm } from '../../components/stock/LoteStockForm'
import { HistorialLotes } from '../../components/stock/HistorialLotes'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { PestanasStock } from './PestanasStock'

// F-STK-10: pestaña «Carga en lote» dentro de Stock. El formulario se oculta con solo lectura; el
// historial queda visible (la RLS y la RPC son la autorización real). El stock es único por
// organización (MSF-231): la pantalla no consulta ni filtra por empresa.
export function LoteStock() {
  const [revision, setRevision] = useState(0)
  const { nivel, isLoading } = useNivelSeccion('stock')

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="lote" />
        {isLoading ? <EstadoCargaPagina /> : nivel === 'edicion' ? (
          <LoteStockForm onRegistrado={() => setRevision((valor) => valor + 1)} />
        ) : (
          <Alert severity="info">Tu rol puede ver el historial, pero no registrar lotes de stock.</Alert>
        )}
        <Divider sx={{ my: 3 }} />
        <HistorialLotes revision={revision} />
      </ContenedorSeccion>
    </Box>
  )
}
