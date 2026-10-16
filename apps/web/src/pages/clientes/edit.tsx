import { useNavigate, useParams } from 'react-router'
import { useOne, useUpdate } from '@refinedev/core'
import { Box } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { type Cliente, aFormulario } from '../../lib/clientes'
import { FormularioCliente } from '../../components/clientes/FormularioCliente'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// Edición de cliente (F-CLI-01, FR-001). RLS rechaza igual la escritura de
// quien no tiene edición en Clientes aunque llegue por URL directa.
export function ClienteEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const { query } = useOne<Cliente>({ resource: 'clientes', id })
  const { mutateAsync } = useUpdate()
  const cliente = query.data?.data

  return (
    <Box>
      <EncabezadoPagina titulo="Editar cliente" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null || query.isLoading ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede editar clientes." />
        ) : query.isError ? (
          <EstadoError descripcion="No pudimos cargar el cliente." reintentar={() => void query.refetch()} />
        ) : !cliente ? (
          <EstadoError titulo="Cliente no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : cliente.es_consumidor_final ? (
          <EstadoError titulo="No se puede editar" descripcion="El Consumidor final es del mostrador y no se edita." />
        ) : (
          <FormularioCliente
            key={cliente.id}
            inicial={aFormulario(cliente)}
            etiquetaGuardar="Guardar cambios"
            rutaCancelar={`/clientes/show/${cliente.id}`}
            onGuardar={async (valores) => {
              await mutateAsync({ resource: 'clientes', id: cliente.id, values: valores, successNotification: false })
              navigate(`/clientes/show/${cliente.id}`, { state: { mensaje: 'Cliente guardado' } })
            }}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
