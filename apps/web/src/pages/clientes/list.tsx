import { useTable } from '@refinedev/core'
import { CreateButton, EditButton } from '@refinedev/mui'
import { Box } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Cliente = {
  id: string
  nombre: string
  created_at: string
}

const columnas: ColumnaAdaptable<Cliente>[] = [
  { clave: 'nombre', encabezado: 'Nombre', render: (cliente) => cliente.nombre },
  { clave: 'creado', encabezado: 'Creado', render: (cliente) => new Date(cliente.created_at).toLocaleString() },
]

// Visible para administrador y miembro por igual (US3): la diferencia es
// que el miembro no ve acciones de crear/editar. RLS aplica el mismo
// límite del lado del servidor aunque alguien llegue a /clientes/edit/:id
// directamente (FR-011).
export function ClienteList() {
  const { puedeEscribir } = usePuedeEscribir()
  const { tableQuery } = useTable<Cliente>({ resource: 'clientes', syncWithLocation: false })
  const clientes = tableQuery.data?.data ?? []

  return (
    <Box>
      <EncabezadoPagina titulo="Clientes" accion={puedeEscribir ? <CreateButton /> : undefined} contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {tableQuery.isLoading ? (
          <EstadoCargaPagina />
        ) : tableQuery.isError ? (
          <EstadoError descripcion="No pudimos cargar los clientes." reintentar={() => tableQuery.refetch()} />
        ) : clientes.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay clientes cargados." />
        ) : (
          <ContenidoAdaptable
            items={clientes}
            columnas={columnas}
            obtenerClave={(cliente) => cliente.id}
            etiquetaTabla="Clientes"
            acciones={puedeEscribir ? (cliente) => <EditButton hideText recordItemId={cliente.id} /> : undefined}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
