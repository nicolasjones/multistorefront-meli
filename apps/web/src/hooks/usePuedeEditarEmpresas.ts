import { useNivelSeccion } from './useNivelSeccion'

// ¿Puede la persona editar los datos de las empresas? Es el mismo criterio que la RLS de `dominio.empresas`
// (`empresas_update` exige `nivel_seccion('empresas') = 'edicion'`), no «es administrador»: un rol personalizado con la sección
// Empresas en edición puede guardar, y uno en lectura no. Solo gatea la interfaz; la autorización real es la RLS.
// `puedeEditar` es null mientras se cargan los permisos. Crear una empresa sigue siendo del administrador (`usePuedeEscribir`).
export function usePuedeEditarEmpresas() {
  const { nivel, isLoading } = useNivelSeccion('empresas')
  return { puedeEditar: isLoading || nivel === null ? null : nivel === 'edicion', isLoading }
}
