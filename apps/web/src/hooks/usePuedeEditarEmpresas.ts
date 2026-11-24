import { useNivelSeccion } from './useNivelSeccion'

// ¿Puede la persona editar los datos de las empresas? Es el mismo criterio que la RLS de `dominio.empresas`
// (`empresas_update` exige `nivel_seccion('empresas') = 'edicion'`), no «es administrador»: un rol personalizado con la sección
// Empresas en edición puede guardar, y uno en lectura no. Solo gatea la interfaz; la autorización real es la RLS.
// Con el repedido de permisos fallido, `useNivelSeccion` puede devolver el último nivel confirmado marcado `sinConfirmar`: eso
// tampoco habilita editar. `puedeEditar` es null SOLO mientras se cargan los permisos; si la carga falla (o no hay permisos) es false: la pantalla cae a
// restringido o solo lectura, nunca a edición y nunca queda cargando para siempre. Crear una empresa sigue siendo del administrador (`usePuedeEscribir`).
export function usePuedeEditarEmpresas() {
  const { nivel, isLoading, sinConfirmar } = useNivelSeccion('empresas')
  return { puedeEditar: isLoading ? null : nivel === 'edicion' && !sinConfirmar, isLoading }
}
