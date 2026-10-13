import { beforeEach, describe, expect, it, vi } from 'vitest'

// A diferencia de authProvider.test.ts, aquí NO se mockea ../lib/supabase: se
// usa el módulo real (incluido su listener SIGNED_OUT) y solo se sustituye el
// cliente de Auth, para que signOut emita el evento como lo hace el real.
const cliente = vi.hoisted(() => {
  const escuchas: Array<(evento: string) => void> = []
  return {
    escuchas,
    rpc: vi.fn(async () => ({ data: null, error: null })),
    signInWithPassword: vi.fn(),
    // El evento llega después de que signOut resuelve, como en supabase-js.
    signOut: vi.fn(async () => {
      setTimeout(() => escuchas.forEach((escucha) => escucha('SIGNED_OUT')), 0)
      return { error: null }
    }),
    maybeSingle: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: cliente.rpc,
    auth: {
      signInWithPassword: cliente.signInWithPassword,
      signOut: cliente.signOut,
      onAuthStateChange: (escucha: (evento: string) => void) => {
        cliente.escuchas.push(escucha)
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: cliente.maybeSingle }) }) }),
  }),
}))

import { authProvider } from './authProvider'

describe('authProvider.login con el listener SIGNED_OUT real', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    cliente.signInWithPassword.mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
      error: null,
    })
    cliente.maybeSingle.mockResolvedValue({ data: { estado: 'suspendido' } })
  })

  it('el rechazo del suspendido no pisa la marca «Mantener la sesión» de otra pestaña', async () => {
    window.localStorage.setItem('msf.mantener-sesion', '1')

    await authProvider.login({ email: 'a@example.com', password: 'bien', remember: false })

    expect(cliente.signOut).toHaveBeenCalled()
    expect(window.localStorage.getItem('msf.mantener-sesion')).toBe('1')
  })

  it('el rechazo del suspendido sin marca previa no deja la marca puesta', async () => {
    await authProvider.login({ email: 'a@example.com', password: 'bien', remember: true })

    expect(window.localStorage.getItem('msf.mantener-sesion')).toBeNull()
  })
})
