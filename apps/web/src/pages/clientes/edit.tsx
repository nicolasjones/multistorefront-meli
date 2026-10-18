import { useNavigate, useParams } from 'react-router'
import { useOne, useUpdate } from '@refinedev/core'
import { Box } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useEmpresasDeCliente, useGuardarEmpresasDeCliente } from '../../hooks/useEmpresasDeCliente'
import { type Cliente, aFormulario } from '../../lib/clientes'
import { FormularioCliente } from '../../components/clientes/FormularioCliente'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// Edición de cliente (F-CLI-01, FR-001). RLS rechaza igual la escritura de
// quien no tiene edición en Clientes aunque llegue por URL directa.
// Tiendas (F-CLI-05): se cargan las actuales para preseleccionarlas y al guardar
// se reemplaza el conjunto con public.guardar_empresas_de_cliente.
export function ClienteEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const { query } = useOne<Cliente>({ resource: 'clientes', id })
  const { mutateAsync } = useUpdate()
  const { empresas, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresas()
  const { empresas: tiendas, isLoading: cargandoTiendas, isError: errorTiendas, refetch: reintentarTiendas } = useEmpresasDeCliente(id)
  const { guardar } = useGuardarEmpresasDeCliente()
  const cliente = query.data?.data

  return (
    <Box>
      <EncabezadoPagina titulo="Editar cliente" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null || query.isLoading || (nivel === 'edicion' && (cargandoEmpresas || cargandoTiendas)) ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede editar clientes." />
        ) : query.isError ? (
          <EstadoError descripcion="No pudimos cargar el cliente." reintentar={() => void query.refetch()} />
        ) : !cliente ? (
          <EstadoError titulo="Cliente no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : cliente.es_consumidor_final ? (
          <EstadoError titulo="No se puede editar" descripcion="El Consumidor final es del mostrador y no se edita." />
        ) : errorTiendas ? (
          <EstadoError descripcion="No pudimos cargar las tiendas del cliente." reintentar={() => void reintentarTiendas()} />
        ) : (
          <FormularioCliente
            key={cliente.id}
            inicial={aFormulario(cliente, tiendas)}
            numero={cliente.numero}
            empresas={empresas}
            cargandoEmpresas={cargandoEmpresas}
            errorEmpresas={errorEmpresas}
            etiquetaGuardar="Guardar cambios"
            rutaCancelar={`/clientes/show/${cliente.id}`}
            onGuardar={async (valores) => {
              const { empresas: seleccion, ...datos } = valores
              await mutateAsync({ resource: 'clientes', id: cliente.id, values: datos, successNotification: false })
              // Si fallan las tiendas, la edición del cliente ya quedó: se propaga el
              // error para reintentar (guardar de nuevo no duplica nada).
              await guardar(cliente.id, seleccion)
              navigate(`/clientes/show/${cliente.id}`, { state: { mensaje: 'Cliente guardado' } })
            }}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
