import { useNavigate } from 'react-router'
import { useCreate } from '@refinedev/core'
import { Box } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { FORMULARIO_CLIENTE_VACIO } from '../../lib/clientes'
import { FormularioCliente } from '../../components/clientes/FormularioCliente'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// Alta de cliente (F-CLI-01, FR-001). La organización y el número los
// resuelve la base; el permiso real lo aplica RLS (nivel_seccion('clientes')),
// acá solo se evita ofrecer el formulario a quien no puede editar.
export function ClienteCreate() {
  const navigate = useNavigate()
  const { nivel, isLoading } = useNivelSeccion('clientes')
  const { mutateAsync } = useCreate<{ id: string }>()

  return (
    <Box>
      <EncabezadoPagina titulo="Nuevo cliente" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {isLoading || nivel === null ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede crear clientes." />
        ) : (
          <FormularioCliente
            inicial={FORMULARIO_CLIENTE_VACIO}
            etiquetaGuardar="Crear cliente"
            rutaCancelar="/clientes"
            onGuardar={async (valores) => {
              const { data } = await mutateAsync({ resource: 'clientes', values: valores, successNotification: false })
              navigate(`/clientes/show/${data.id}`, { state: { mensaje: 'Cliente creado' } })
            }}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
