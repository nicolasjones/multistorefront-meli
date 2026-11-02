import { useEffect, useState } from 'react'
import { useGetIdentity } from '@refinedev/core'
import { supabaseClient } from '../../lib/supabase'

type Identity = { id: string }

// Nombre de pila del perfil propio para el saludo (RLS: solo lee su fila). Si no hay, el saludo va sin nombre:
// nunca se muestra el correo ni un identificador técnico (FR-011).
export function useNombrePerfil(): string | null {
  const { data: identity } = useGetIdentity<Identity>()
  const [lectura, setLectura] = useState<{ userId: string; nombre: string | null } | null>(null)
  const userId = identity?.id ?? null

  useEffect(() => {
    if (!userId) return
    let activa = true
    void Promise.resolve(supabaseClient.from('perfiles_usuario').select('nombre').eq('user_id', userId).maybeSingle<{ nombre: string | null }>())
      .then(({ data }) => { if (activa) setLectura({ userId, nombre: data?.nombre?.trim() || null }) })
      .catch(() => { if (activa) setLectura({ userId, nombre: null }) })
    return () => { activa = false }
  }, [userId])

  return lectura && lectura.userId === userId ? lectura.nombre : null
}
