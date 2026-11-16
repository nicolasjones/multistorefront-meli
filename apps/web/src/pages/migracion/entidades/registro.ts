// Registro de entidades del asistente de migración (FR-001). Cada historia suma su
// definición acá sin tocar el asistente.

import type { DefinicionEntidad } from '../../../lib/migracion'
import { ENTIDAD_CLIENTES } from './clientes'
import { ENTIDAD_INGRESOS } from './ingresos'
import { ENTIDAD_PROVEEDORES } from './proveedores'
import { ENTIDAD_VINCULOS } from './vinculos'

export const ENTIDADES_MIGRACION: Readonly<Record<string, DefinicionEntidad>> = {
  clientes: ENTIDAD_CLIENTES,
  ingresos_archivo: ENTIDAD_INGRESOS,
  proveedores: ENTIDAD_PROVEEDORES,
  vinculos_proveedor_producto: ENTIDAD_VINCULOS,
}

/** Acepta el id de la entidad o su forma de URL (`vinculos-proveedor-producto`). */
export function obtenerEntidad(id: string | undefined): DefinicionEntidad | null {
  if (!id) return null
  const clave = id.replace(/-/g, '_')
  return Object.hasOwn(ENTIDADES_MIGRACION, clave) ? ENTIDADES_MIGRACION[clave] : null
}
