import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { auth: { getUser: mocks.getUser }, from: mocks.from } }))

import { ROL_GENERICO, etiquetaDeRol, resolverRolId } from './rolActual'

const membresia = (resultado: unknown) => {
  const filtros: Array<[string, unknown]> = []
  const q = { select: () => q, eq: (c: string, v: unknown) => { filtros.push([c, v]); return q }, maybeSingle: () => Promise.resolve(resultado) }
  mocks.from.mockReturnValue(q)
  return filtros
}

describe('resolverRolId', () => {
  beforeEach(() => { mocks.getUser.mockReset(); mocks.from.mockReset() })

  it('devuelve el rol de la membresía filtrando por usuario y organización', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const filtros = membresia({ data: { rol_id: 'operador' }, error: null })
    await expect(resolverRolId('org-1')).resolves.toBe('operador')
    expect(filtros).toEqual([['user_id', 'u1'], ['organizacion_id', 'org-1']])
  })

  it('devuelve vacío sin sesión o sin organización, sin consultar la base', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })
    await expect(resolverRolId('org-1')).resolves.toBe('')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    await expect(resolverRolId(null)).resolves.toBe('')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('devuelve vacío si la consulta falla o no hay membresía', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    membresia({ data: null, error: { code: '42501' } })
    await expect(resolverRolId('org-1')).resolves.toBe('')
    membresia({ data: null, error: null })
    await expect(resolverRolId('org-1')).resolves.toBe('')
  })
})

describe('etiquetaDeRol', () => {
  it('usa el nombre visible y el genérico si el rol es desconocido', () => {
    expect(etiquetaDeRol('operador')).not.toBe(ROL_GENERICO)
    expect(etiquetaDeRol('rol-que-no-existe')).toBe(ROL_GENERICO)
  })
})
