// Los seis roles de negocio invitables (F-USR-01, FR-009). Los ids son filas de
// `roles_organizacion`; las descripciones replican las de la migración
// 20261013130000 (ver docs/permisos-por-rol.md). `miembro` es el rol heredado
// del template: se muestra pero ya no se ofrece para invitar.
export type RolUsuario = { id: string; nombre: string; descripcion: string }

export const ROLES_INVITABLES: RolUsuario[] = [
  { id: 'administrador', nombre: 'Administrador', descripcion: 'Acceso total y gestión de usuarios y permisos.' },
  { id: 'operador', nombre: 'Operador', descripcion: 'Productos, stock, ventas y clientes.' },
  { id: 'consulta', nombre: 'Consulta', descripcion: 'Solo lectura.' },
  { id: 'mostrador', nombre: 'Mostrador', descripcion: 'Vende en el local: comprobantes y clientes.' },
  { id: 'deposito', nombre: 'Depósito', descripcion: 'Arma y entrega pedidos, mueve stock.' },
  { id: 'administracion', nombre: 'Administración', descripcion: 'Cobros, proveedores y reportes.' },
]

const NOMBRES: Record<string, string> = {
  ...Object.fromEntries(ROLES_INVITABLES.map((rol) => [rol.id, rol.nombre])),
  miembro: 'Miembro',
  tecnico: 'Técnico',
}

export const nombreDeRol = (rolId: string) => NOMBRES[rolId] ?? rolId

// Destino de «Ver permisos de este rol →»: la matriz editable de F-ROL-02 (ruta /roles).
export const PERMISOS_POR_ROL_DISPONIBLE = true
export const rutaPermisosDeRol = (rolId: string) => `/roles?rol=${encodeURIComponent(rolId)}`
