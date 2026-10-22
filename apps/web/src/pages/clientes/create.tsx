import { useNavigate } from 'react-router'
import { useCreate } from '@refinedev/core'
import { Box } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useGuardarEmpresasDeCliente } from '../../hooks/useEmpresasDeCliente'
import { FORMULARIO_CLIENTE_VACIO } from '../../lib/clientes'
import { FormularioCliente } from '../../components/clientes/FormularioCliente'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// Alta de cliente (F-CLI-01, FR-001). La organización y el número los
// resuelve la base; el permiso real lo aplica RLS (nivel_seccion('clientes')),
// acá solo se evita ofrecer el formulario a quien no puede editar.
// Tiendas (F-CLI-05): el cliente se crea y luego se guarda en qué tiendas queda
// habilitado (la RPC necesita el id recién creado). Un cliente nuevo arranca
// habilitado en todas las tiendas, como el prototipo.
export function ClienteCreate() {
  const navigate = useNavigate()
  const { nivel, isLoading } = useNivelSeccion('clientes')
  const { mutateAsync } = useCreate<{ id: string }>()
  const { empresas, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresas()
  const { guardar } = useGuardarEmpresasDeCliente()

  return (
    <Box>
      <EncabezadoPagina titulo="Nuevo cliente" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {isLoading || nivel === null ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede crear clientes." />
        ) : cargandoEmpresas ? (
          <EstadoCargaPagina />
        ) : (
          <FormularioCliente
            inicial={{ ...FORMULARIO_CLIENTE_VACIO, empresas: empresas.map((empresa) => empresa.id) }}
            empresas={empresas}
            cargandoEmpresas={cargandoEmpresas}
            errorEmpresas={errorEmpresas}
            etiquetaGuardar="Crear cliente"
            rutaCancelar="/clientes"
            onGuardar={async (valores) => {
              const { empresas: tiendas, ...datos } = valores
              const { data } = await mutateAsync({ resource: 'clientes', values: datos, successNotification: false })
              // Si falla guardar las tiendas, el cliente ya quedó creado: se avisa por
              // consola y se sigue a la ficha, donde se pueden volver a asignar (no se
              // reintenta el alta para no duplicar el cliente).
              try {
                await guardar(data.id, tiendas)
              } catch (error) {
                console.error('Cliente creado pero no se pudieron guardar sus tiendas', error)
              }
              navigate(`/clientes/show/${data.id}`, { state: { mensaje: 'Cliente creado' } })
            }}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
