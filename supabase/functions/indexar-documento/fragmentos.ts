// Escritura de fragmentos con el cliente de SERVICIO (sin imports de Deno ni de Supabase: se prueba con `node --test`).
// Solo se llama después de la autorización del handler (funcionalidad, RLS sobre la versión, permiso y reclamo propio) y
// acota SIEMPRE por la versión y la organización que el usuario ve por RLS (MSF-651).
export type FilaFragmento = { version_id: string; organizacion_id: string; texto: string; embedding: string; orden: number }

// Lo mínimo que se necesita del cliente de servicio (index.ts lo arma sobre supabase-js, sin `any`).
export type ClienteFragmentos = {
  borrar(versionId: string, organizacionId: string): PromiseLike<{ error: unknown }>
  insertar(filas: FilaFragmento[]): PromiseLike<{ error: unknown }>
}

// La versión tal como la ve el usuario por RLS (null si no existe, es de otra organización o no tiene acceso).
export type VersionDelUsuario = (jwt: string, versionId: string) => Promise<{ organizacion_id: string } | null>

export function escrituraFragmentos(servicio: ClienteFragmentos, versionDelUsuario: VersionDelUsuario, loteInsercion = 100) {
  return {
    borrarFragmentos: async (jwt: string, versionId: string): Promise<boolean> => {
      const version = await versionDelUsuario(jwt, versionId)
      if (!version) return false
      const { error } = await servicio.borrar(versionId, version.organizacion_id)
      return !error
    },
    insertarFragmentos: async (jwt: string, filas: FilaFragmento[]): Promise<boolean> => {
      if (filas.length === 0) return true
      const versionId = filas[0].version_id
      const version = await versionDelUsuario(jwt, versionId)
      if (!version || filas.some((f) => f.version_id !== versionId || f.organizacion_id !== version.organizacion_id)) return false
      for (let i = 0; i < filas.length; i += loteInsercion) {
        if ((await servicio.insertar(filas.slice(i, i + loteInsercion))).error) return false
      }
      return true
    },
  }
}
