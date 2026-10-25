import { useNavigate } from 'react-router'
import { useCreate } from '@refinedev/core'
import { Box } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'

import { useEmpresas } from '../../hooks/useEmpresas'
import { useGuardarEmpresasDeCliente } from '../../hooks/useEmpresasDeCliente'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { FORMULARIO_CLIENTE_VACIO } from '../../lib/clientes'
import { aplicarCuentaWebEnTiendas } from '../../lib/cuentasCliente'
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

  const { empresas, isLoading: cargandoEmpresas, isError: errorEmpresas } = useEmpresas()
  const { guardar } = useGuardarEmpresasDeCliente()
  // Principio VIII: al cambiar la empresa activa el formulario se reencuadra
  // (se remonta) y no guarda la selección de tiendas de la empresa anterior.
  const { empresaActivaId } = useEmpresasAccesibles()

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
            key={`nuevo:${empresaActivaId ?? 'todas'}`}
            inicial={{ ...FORMULARIO_CLIENTE_VACIO, empresas: empresas.map((empresa) => empresa.id) }}
            empresas={empresas}
            cargandoEmpresas={cargandoEmpresas}
            errorEmpresas={errorEmpresas}
            etiquetaGuardar="Crear cliente"
            rutaCancelar="/clientes"
            onGuardar={async (valores, opciones) => {
              const { empresas: tiendas, ...datos } = valores
              const { data } = await mutateAsync({ resource: 'clientes', values: datos, successNotification: false })
              // Si falla guardar las tiendas, el cliente ya quedó creado: se avisa por
              // consola y se sigue a la ficha, donde se pueden volver a asignar (no se
              // reintenta el alta para no duplicar el cliente).
              let tiendasGuardadas = true
              try {
                await guardar(data.id, tiendas)
              } catch (error) {
                tiendasGuardadas = false
                console.error('Cliente creado pero no se pudieron guardar sus tiendas', error)
              }
              // Crea/suspende la cuenta web en cada tienda tildada (FR-015). Un fallo
              // parcial no revierte el cliente: se informa al llegar a la ficha.
              const { errores } = tiendasGuardadas
                ? await aplicarCuentaWebEnTiendas(data.id, tiendas, opciones.estado, opciones.invitar)
                : { errores: tiendas.length }
              const invitacion = opciones.estado === 'activa' && opciones.invitar && errores === 0
              const mensaje = errores > 0
                ? `Cliente creado · no se pudo crear la cuenta web en ${errores} ${errores === 1 ? 'tienda' : 'tiendas'}`
                : invitacion ? 'Cliente creado · invitación enviada' : 'Cliente creado'
              navigate(`/clientes/show/${data.id}`, { state: { mensaje } })
            }}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
