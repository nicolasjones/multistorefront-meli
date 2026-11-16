import { Box, Stack } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { useApiTabla, type Llamada } from './datos'

const COLUMNAS = 'id, metodo, ruta, version, estado_http, duracion_ms, creada_en'

/** Llamadas recientes a la API (FR-008, FR-014). */
export function PanelLlamadas() {
  const { filas, hayError, recargar } = useApiTabla<Llamada>('api_llamadas', COLUMNAS, 'creada_en')

  const columnas: ColumnaAdaptable<Llamada>[] = [
    { clave: 'cuando', encabezado: 'Cuándo', render: (llamada) => new Date(llamada.creada_en).toLocaleString() },
    { clave: 'metodo', encabezado: 'Método', render: (llamada) => llamada.metodo },
    { clave: 'ruta', encabezado: 'Ruta', render: (llamada) => <code>{llamada.ruta}</code> },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (llamada) => (
        <EtiquetaEstado
          texto={String(llamada.estado_http)}
          variante={llamada.estado_http >= 400 ? 'error' : 'exito'}
        />
      ),
    },
    { clave: 'duracion', encabezado: 'Duración', render: (llamada) => (llamada.duracion_ms === null ? '—' : `${llamada.duracion_ms} ms`) },
  ]

  if (hayError) return <EstadoError descripcion="No pudimos cargar las llamadas." reintentar={recargar} />
  if (filas === null) return <EstadoCargaPagina />
  if (filas.length === 0) return <EstadoVacio titulo="Todavía no hay llamadas registradas." />

  return (
    <Box>
      <Stack spacing={2}>
        <ContenidoAdaptable
          items={filas}
          columnas={columnas}
          obtenerClave={(llamada) => llamada.id}
          etiquetaTabla="Llamadas recientes"
        />
      </Stack>
    </Box>
  )
}
