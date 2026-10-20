import { type ComponentType, useState } from 'react'
import { Box, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useEmpresasAccesibles } from '../../../hooks/useEmpresasAccesibles'
import { useNivelSeccion } from '../../../hooks/useNivelSeccion'
import { usePuedeEscribir } from '../../../hooks/usePuedeEscribir'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import type { EmpresaOpcion } from '../../../components/ventas/FormaPagoDialog'
import { FormasEnvioTab } from './FormasEnvioTab'
import { FormasPagoTab } from './FormasPagoTab'

// Lo que recibe cada pestaña de catálogo: la empresa elegida arriba, las demás empresas entre
// las que puede repartirse un alta y si la persona puede escribir (Administrador con edición).
export type PropsPestanaCatalogo = {
  empresa: EmpresaOpcion
  empresas: EmpresaOpcion[]
  puedeEditar: boolean
}

type PestanaCatalogo = { id: string; etiqueta: string; Componente: ComponentType<PropsPestanaCatalogo> }

// Un catálogo por pestaña. Cada historia de la épica registra la suya acá.
const PESTANAS_CATALOGO: PestanaCatalogo[] = [
  { id: 'formas-pago', etiqueta: 'Formas de pago', Componente: FormasPagoTab },
  { id: 'formas-envio', etiqueta: 'Formas de envío', Componente: FormasEnvioTab },
]

// Pantalla «Configuración de ventas» (F-VTA-01, FR-003): catálogos que usa el comprobante, uno
// por empresa. El selector `Empresa` arranca en la empresa activa de la barra superior y los
// cambios aplican solo a la elegida. El acceso por sección lo resuelve la ruta
// (RequiereAccesoSeccion → «Acceso restringido») y la base lo aplica por RLS.
export function ConfiguracionVentas() {
  const { nivel } = useNivelSeccion('ventas')
  const { puedeEscribir } = usePuedeEscribir()
  const { empresas, empresaActivaId, isLoading, isError, refetch } = useEmpresasAccesibles()
  const [elegidaId, setElegidaId] = useState<string | null>(null)
  const [pestana, setPestana] = useState(0)

  // Solo el Administrador escribe (RLS); `edicion` en la sección es necesaria pero no suficiente.
  const puedeEditar = nivel === 'edicion' && puedeEscribir === true
  const opciones: EmpresaOpcion[] = empresas.map(({ id, nombre }) => ({ id, nombre }))
  // Si la elegida ya no es accesible (cambió la empresa activa o los permisos), vuelve a la activa.
  const empresa = opciones.find((opcion) => opcion.id === (elegidaId ?? empresaActivaId)) ?? opciones[0] ?? null
  const actual = PESTANAS_CATALOGO[pestana] ?? PESTANAS_CATALOGO[0]
  const Componente = actual.Componente

  return (
    <Box>
      <EncabezadoPagina
        titulo="Configuración de ventas"
        descripcion="Catálogos que usa el comprobante. Cada empresa tiene los suyos."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar tus empresas." reintentar={() => void refetch()} />
        ) : empresa === null ? (
          <EstadoVacio titulo="No tenés empresas para configurar." descripcion="Pedile al Administrador que te asigne una." />
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography id="etiqueta-empresa-catalogo" variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Empresa</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                aria-labelledby="etiqueta-empresa-catalogo"
                value={empresa.id}
                onChange={(_, valor: string | null) => { if (valor !== null) setElegidaId(valor) }}
              >
                {opciones.map((opcion) => <ToggleButton key={opcion.id} value={opcion.id}>{opcion.nombre}</ToggleButton>)}
              </ToggleButtonGroup>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Cada tienda tiene sus propios catálogos. Arranca en la empresa activa de la barra superior; los cambios aplican solo a la elegida.
              </Typography>
            </Box>

            <Tabs
              value={pestana}
              onChange={(_, valor: number) => setPestana(valor)}
              aria-label="Catálogos de ventas"
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
            >
              {PESTANAS_CATALOGO.map((candidata) => <Tab key={candidata.id} label={candidata.etiqueta} />)}
            </Tabs>

            <Componente key={`${actual.id}-${empresa.id}`} empresa={empresa} empresas={opciones} puedeEditar={puedeEditar} />
          </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
