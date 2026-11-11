import { Box, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { useApiTabla, type Entrega } from './datos'

const COLUMNAS = 'id, evento_id, suscripcion_id, estado, intentos, ultimo_estado_http, ultimo_error_sanitizado, creada_en, actualizada_en'

const varianteDe = (estado: Entrega['estado']) => {
  if (estado === 'completada') return 'exito' as const
  if (estado === 'agotada') return 'error' as const
  if (estado === 'reclamada') return 'aviso' as const
  return 'neutral' as const
}

/** Entregas recientes de los avisos (FR-012, FR-014). */
export function PanelEntregas() {
  const { filas, hayError, recargar } = useApiTabla<Entrega>('api_entregas', COLUMNAS, 'creada_en')

  const columnas: ColumnaAdaptable<Entrega>[] = [
    { clave: 'evento', encabezado: 'Evento', render: (entrega) => entrega.evento_id },
    { clave: 'destino', encabezado: 'Destino', render: (entrega) => entrega.suscripcion_id },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (entrega) => <EtiquetaEstado texto={entrega.estado} variante={varianteDe(entrega.estado)} />,
    },
    { clave: 'intentos', encabezado: 'Intentos', render: (entrega) => String(entrega.intentos) },
    {
      clave: 'error',
      encabezado: 'Último error',
      render: (entrega) => (
        <Typography variant="body2" color="text.secondary">
          {entrega.ultimo_error_sanitizado ?? '—'}
          {entrega.ultimo_estado_http ? ` (${entrega.ultimo_estado_http})` : ''}
        </Typography>
      ),
    },
  ]

  if (hayError) return <EstadoError descripcion="No pudimos cargar las entregas." reintentar={recargar} />
  if (filas === null) return <EstadoCargaPagina />
  if (filas.length === 0) return <EstadoVacio titulo="Todavía no hay entregas." />

  return (
    <Box>
      <Stack spacing={2}>
        <ContenidoAdaptable
          items={filas}
          columnas={columnas}
          obtenerClave={(entrega) => entrega.id}
          etiquetaTabla="Entregas de avisos"
        />
      </Stack>
    </Box>
  )
}
