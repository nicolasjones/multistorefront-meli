import { useState } from 'react'
import { Alert, Box, Divider, Tab, Tabs } from '@mui/material'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { IngresoMercaderiaForm } from '../../components/stock/IngresoMercaderiaForm'
import { HistorialIngresos } from '../../components/stock/HistorialIngresos'
import { ArchivoIngresos } from '../../components/stock/ArchivoIngresos'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { EstadoCargaPagina } from '../../components/estados/EstadosPagina'
import { PestanasStock } from './PestanasStock'

// F-PRV-04/F-PRV-05: pestaña «Ingreso de mercadería» dentro de Stock. El formulario
// se oculta con solo lectura; el historial queda visible (RLS es la autorización real).
// F-MIG-03: segunda pestaña «Archivo anterior al sistema» (solo consulta).
export function IngresosMercaderia() {
  const [revision, setRevision] = useState(0)
  const [vista, setVista] = useState<'ingresos' | 'archivo'>('ingresos')
  const { nivel, isLoading } = useNivelSeccion('stock')

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="ingresos" />
        <Tabs
          value={vista}
          onChange={(_, nueva: 'ingresos' | 'archivo') => setVista(nueva)}
          aria-label="Vistas de ingreso de mercadería"
          sx={{ mb: 2 }}
        >
          <Tab value="ingresos" label="Ingresos" id="tab-ingresos" aria-controls="panel-ingresos" />
          <Tab value="archivo" label="Archivo anterior al sistema" id="tab-archivo" aria-controls="panel-archivo" />
        </Tabs>
        {vista === 'archivo' ? (
          <Box role="tabpanel" id="panel-archivo" aria-labelledby="tab-archivo">
            <ArchivoIngresos />
          </Box>
        ) : (
          <Box role="tabpanel" id="panel-ingresos" aria-labelledby="tab-ingresos">
            {isLoading ? <EstadoCargaPagina /> : nivel === 'edicion' ? (
              <IngresoMercaderiaForm onRegistrado={() => setRevision((valor) => valor + 1)} />
            ) : (
              <Alert severity="info">Tu rol puede ver el historial, pero no registrar ingresos de mercadería.</Alert>
            )}
            <Divider sx={{ my: 3 }} />
            <HistorialIngresos revision={revision} />
          </Box>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
