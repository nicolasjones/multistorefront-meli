// Escritura de fragmentos con el cliente de SERVICIO (sin imports de Deno ni de Supabase: se prueba con `node --test`).
// Solo se llama después de la autorización del handler (funcionalidad, RLS sobre la versión, permiso y reclamo propio) y
// acota SIEMPRE por la versión y la organización que el usuario ve por RLS (MSF-651).
export type FilaFragmento = { version_id: string; organizacion_id: string; texto: string; embedding: string; orden: number }

// Lo mínimo que se necesita del cliente de servicio (index.ts lo arma sobre supabase-js, sin `any`).
export type ClienteFragmentos = {
  // Borrado condicional atómico (SQL `borrar_fragmentos_si_dueno`): `data` es `true` solo si borró (la versión era de la organización y seguía en manos del reclamo).
  borrar(versionId: string, organizacionId: string, reclamo: string): PromiseLike<{ data?: unknown; error: unknown }>
  // Inserción condicional atómica (SQL `insertar_fragmentos_si_dueno`): `data` es `true` solo si la versión seguía `procesando` con el reclamo propio y era de la organización.
  insertar(versionId: string, organizacionId: string, reclamo: string, filas: Array<Omit<FilaFragmento, 'version_id' | 'organizacion_id'>>): PromiseLike<{ data?: unknown; error: unknown }>
}

// La versión tal como la ve el usuario por RLS (null si no existe, es de otra organización o no tiene acceso).
export type VersionDelUsuario = (jwt: string, versionId: string) => Promise<{ organizacion_id: string } | null>

export function escrituraFragmentos(servicio: ClienteFragmentos, versionDelUsuario: VersionDelUsuario, loteInsercion = 100) {
  return {
    borrarFragmentos: async (jwt: string, versionId: string, reclamo: string): Promise<boolean> => {
      const version = await versionDelUsuario(jwt, versionId)
      if (!version) return false
      const { data, error } = await servicio.borrar(versionId, version.organizacion_id, reclamo)
      if (error) console.error('indexar-documento: no se pudieron borrar los fragmentos', (error as { code?: string }).code ?? '')
      return !error && data === true
    },
    insertarFragmentos: async (jwt: string, filas: FilaFragmento[], reclamo: string): Promise<boolean> => {
      if (filas.length === 0) return true
      const versionId = filas[0].version_id
      const version = await versionDelUsuario(jwt, versionId)
      if (!version || filas.some((f) => f.version_id !== versionId || f.organizacion_id !== version.organizacion_id)) return false
      for (let i = 0; i < filas.length; i += loteInsercion) {
        const lote = filas.slice(i, i + loteInsercion).map(({ texto, embedding, orden }) => ({ texto, embedding, orden }))
        // Cada lote re-verifica en SQL que la versión sigue en manos de este reclamo (otra invocación pudo retomarla o activarla).
        const { data, error } = await servicio.insertar(versionId, version.organizacion_id, reclamo, lote)
        if (error) console.error('indexar-documento: no se pudieron insertar los fragmentos', (error as { code?: string }).code ?? '')
        if (error || data !== true) return false
      }
      return true
    },
  }
}
