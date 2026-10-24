import { useNavigate, useParams } from 'react-router'
import { useOne, useUpdate } from '@refinedev/core'
import { Box } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useEmpresasDeCliente, useGuardarEmpresasDeCliente } from '../../hooks/useEmpresasDeCliente'
import { useCuentasWebDeCliente } from '../../hooks/useCuentasWebDeCliente'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { type Cliente, aFormulario } from '../../lib/clientes'
import { aplicarCuentaWebEnTiendas, type EstadoCuentaWebFormulario } from '../../lib/cuentasCliente'
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
  const { cuentas, isLoading: cargandoCuentas, isError: errorCuentas, refetch: reintentarCuentas } = useCuentasWebDeCliente(id)
  // Principio VIII: al cambiar la empresa activa el formulario se reencuadra
  // (se remonta con los datos recargados) y no guarda la tienda de la anterior.
  const { empresaActivaId } = useEmpresasAccesibles()
  const cliente = query.data?.data
  // Estado inicial del campo «Cuenta web»: si alguna tienda está activa, Activa;
  // si no, Suspendida; si no hay ninguna cuenta, Sin cuenta (FR-015).
  const estadoCuentaWeb: EstadoCuentaWebFormulario = cuentas.some((cuenta) => cuenta.estado === 'activa')
    ? 'activa'
    : cuentas.some((cuenta) => cuenta.estado === 'suspendida') ? 'suspendida' : 'sin_cuenta'

  return (
    <Box>
      <EncabezadoPagina titulo="Editar cliente" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null || query.isLoading || (nivel === 'edicion' && (cargandoEmpresas || cargandoTiendas || cargandoCuentas)) ? (
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
        ) : errorCuentas ? (
          <EstadoError descripcion="No pudimos cargar la cuenta web del cliente." reintentar={() => void reintentarCuentas()} />
        ) : (
          <FormularioCliente
            key={`${cliente.id}:${empresaActivaId ?? 'todas'}`}
            inicial={aFormulario(cliente, tiendas, estadoCuentaWeb)}
            numero={cliente.numero}
            empresas={empresas}
            cargandoEmpresas={cargandoEmpresas}
            errorEmpresas={errorEmpresas}
            etiquetaGuardar="Guardar cambios"
            rutaCancelar={`/clientes/show/${cliente.id}`}
            onGuardar={async (valores, opciones) => {
              const { empresas: seleccion, ...datos } = valores
              await mutateAsync({ resource: 'clientes', id: cliente.id, values: datos, successNotification: false })
              // Si fallan las tiendas, la edición del cliente ya quedó: se propaga el
              // error para reintentar (guardar de nuevo no duplica nada).
              await guardar(cliente.id, seleccion)
              // Crea o suspende/reactiva la cuenta en las tiendas tildadas (FR-015);
              // no reenvía invitaciones de cuentas que ya existían.
              const { errores } = await aplicarCuentaWebEnTiendas(cliente.id, seleccion, opciones.estado, opciones.invitar, estadoCuentaWeb)
              navigate(`/clientes/show/${cliente.id}`, {
                state: {
                  mensaje: errores > 0
                    ? `Cliente guardado · no se pudo actualizar la cuenta web en ${errores} ${errores === 1 ? 'tienda' : 'tiendas'}`
                    : 'Cliente guardado',
                },
              })
            }}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
