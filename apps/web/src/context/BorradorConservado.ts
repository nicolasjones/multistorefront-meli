import { createContext } from 'react'

// MSF-855: lo provee `RequiereAccesoSeccion` solo mientras conserva el borrador (misma clave `usuario:organización`
// que cuando se abrió la pantalla y el repedido de permisos falló). Fuera de ese contexto un fallo sigue siendo
// `nivel: null` (falla cerrada).
export const BorradorConservadoContext = createContext<{ clave: string } | null>(null)
