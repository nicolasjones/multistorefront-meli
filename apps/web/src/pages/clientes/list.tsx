import { Link as RouterLink } from 'react-router'
import { useTable } from '@refinedev/core'
import { CreateButton } from '@refinedev/mui'
import { Box, Button } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import type { Cliente } from '../../lib/clientes'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const columnas: ColumnaAdaptable<Cliente>[] = [
  { clave: 'numero', encabezado: 'Nº', render: (cliente) => cliente.numero },
  { clave: 'nombre', encabezado: 'Nombre', render: (cliente) => cliente.nombre },
  { clave: 'documento', encabezado: 'DNI/CUIT', render: (cliente) => cliente.documento ?? '—' },
]

// Quien tiene lectura ve el listado; quien tiene edición en Clientes
// (nivel_seccion) suma «Nuevo cliente». RLS aplica el mismo límite en la base
// aunque alguien llegue a /clientes/edit/:id directamente (FR-004). Los
// archivados no se listan por defecto (el filtro Activos/Archivados es de F-CLI-02).
export function ClienteList() {
  const { nivel } = useNivelSeccion('clientes')
  const puedeEditar = nivel === 'edicion'
  const { tableQuery } = useTable<Cliente>({
    resource: 'clientes',
    syncWithLocation: false,
    filters: { permanent: [{ field: 'archivado_en', operator: 'null', value: true }] },
    sorters: { initial: [{ field: 'numero', order: 'asc' }] },
  })
  const clientes = tableQuery.data?.data ?? []

  return (
    <Box>
      <EncabezadoPagina titulo="Clientes" accion={puedeEditar ? <CreateButton /> : undefined} contexto={<ContextoOrganizacionActiva />} />
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
            acciones={(cliente) => (
              <Button component={RouterLink} to={`/clientes/show/${cliente.id}`} aria-label={`Ver ${cliente.nombre}`}>Ver</Button>
            )}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
