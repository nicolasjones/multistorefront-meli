import { useEffect, useState } from 'react'
import { etiquetaDeRol, resolverRolId, ROL_GENERICO } from '../lib/rolActual'
import { useOrganizacionDeTrabajo } from './useOrganizacionDeTrabajo'

// Nombre visible del rol de la persona en la organización de trabajo, para el mensaje de
// «Acceso restringido» de las pantallas solo-Administrador. Solo consulta cuando `activo`;
// si falla, devuelve el genérico (nunca null tras resolver).
export function useNombreRolActual(activo: boolean): string {
  const { organizacionId } = useOrganizacionDeTrabajo()
  const [nombre, setNombre] = useState(ROL_GENERICO)

  useEffect(() => {
    if (!activo) return
    let cancelada = false
    resolverRolId(organizacionId)
      .catch(() => '')
      .then((rolId) => { if (!cancelada) setNombre(etiquetaDeRol(rolId)) })
    return () => { cancelada = true }
  }, [activo, organizacionId])

  return nombre
}
