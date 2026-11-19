import { describe, expect, it } from 'vitest'
import { PERMISOS_POR_ROL_DISPONIBLE, ROLES_INVITABLES, nombreDeRol, rutaPermisosDeRol } from './rolesUsuarios'

describe('rolesUsuarios', () => {
  it('ofrece siete roles invitables con ids únicos y sin el rol heredado «miembro»', () => {
    const ids = ROLES_INVITABLES.map((rol) => rol.id)
    expect(ids).toHaveLength(7)
    expect(new Set(ids).size).toBe(7)
    expect(ids).not.toContain('miembro')
  })

  it('nombreDeRol traduce los roles invitables y el heredado, y deja el id si es desconocido', () => {
    expect(nombreDeRol('deposito')).toBe('Depósito')
    expect(nombreDeRol('miembro')).toBe('Miembro')
    expect(nombreDeRol('inventado')).toBe('inventado')
  })

  it('rutaPermisosDeRol escapa el id para que viaje seguro en la URL', () => {
    expect(rutaPermisosDeRol('operador')).toBe('/roles?rol=operador')
    expect(rutaPermisosDeRol('a&b=c')).toBe('/roles?rol=a%26b%3Dc')
    expect(PERMISOS_POR_ROL_DISPONIBLE).toBe(true)
  })
})
