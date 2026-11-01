import { describe, expect, it } from 'vitest'
import { ROLES_POR_EMPRESA } from './asignacionesEmpresas'
import { ETIQUETA_ROL } from './permisos'
import { ROLES_INVITABLES, nombreDeRol } from './rolesUsuarios'

// MSF-597 / MSF-606: el Técnico se invita y se asigna por empresa.
describe('roles con Técnico', () => {
  it('el Técnico es un rol por empresa y el Administrador no', () => {
    expect(ROLES_POR_EMPRESA).toContain('tecnico')
    expect(ROLES_POR_EMPRESA).not.toContain('administrador')
    expect(ROLES_POR_EMPRESA).toHaveLength(6)
  })

  it('el Técnico se ofrece al invitar con su etiqueta', () => {
    expect(ROLES_INVITABLES.map((rol) => rol.id)).toContain('tecnico')
    expect(nombreDeRol('tecnico')).toBe('Técnico')
  })

  it('todo rol por empresa tiene etiqueta en el selector', () => {
    for (const id of ROLES_POR_EMPRESA) expect(ETIQUETA_ROL[id]).toBeTruthy()
  })
})
