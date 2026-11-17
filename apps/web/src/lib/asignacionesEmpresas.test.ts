import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))
vi.mock('./empresaActiva', () => ({ listarEmpresasSelector: vi.fn() }))

import { listarEmpresasSelector } from './empresaActiva'
import {
  listarAsignaciones, listarEmpresasAsignables, ROL_POR_DEFECTO_EMPRESA, ROLES_POR_EMPRESA, seleccionAArreglo, seleccionDeUsuario, seleccionesIguales,
} from './asignacionesEmpresas'
import { supabaseClient } from './supabase'

describe('asignación de empresas y roles', () => {
  it('el administrador no es un rol por empresa y el rol por defecto sí lo es', () => {
    expect(ROLES_POR_EMPRESA).not.toContain('administrador')
    expect(ROLES_POR_EMPRESA).toContain('tecnico')
    expect(ROLES_POR_EMPRESA).toContain(ROL_POR_DEFECTO_EMPRESA)
  })

  it('la selección del formulario se convierte a la lista que espera la base y viceversa', () => {
    const seleccion = { e1: 'operador', e2: 'consulta' }
    expect(seleccionAArreglo(seleccion)).toEqual([
      { empresa_id: 'e1', rol_id: 'operador' },
      { empresa_id: 'e2', rol_id: 'consulta' },
    ])
    expect(seleccionDeUsuario([
      { userId: 'u', empresaId: 'e1', empresaNombre: 'Uno', rolId: 'operador' },
      { userId: 'u', empresaId: 'e2', empresaNombre: 'Dos', rolId: 'consulta' },
    ])).toEqual(seleccion)
    expect(seleccionAArreglo({})).toEqual([])
  })

  it('dos selecciones son iguales con las mismas empresas y roles, sin importar el orden', () => {
    expect(seleccionesIguales({ a: 'x', b: 'y' }, { b: 'y', a: 'x' })).toBe(true)
    expect(seleccionesIguales({}, {})).toBe(true)
  })

  it('cambia un rol, sobra una empresa o falta otra: son distintas', () => {
    expect(seleccionesIguales({ a: 'x' }, { a: 'y' })).toBe(false)
    expect(seleccionesIguales({ a: 'x' }, { a: 'x', b: 'x' })).toBe(false)
    expect(seleccionesIguales({ a: 'x', b: 'x' }, { a: 'x', c: 'x' })).toBe(false)
  })

  it('las empresas asignables descartan las filas sin id o sin nombre', async () => {
    vi.mocked(listarEmpresasSelector).mockResolvedValue([
      { id: 'e1', nombre: 'Uno', extra: 1 },
      { id: '', nombre: 'Sin id' },
      { id: 'e3', nombre: '' },
    ] as never)
    expect(await listarEmpresasAsignables()).toEqual([{ id: 'e1', nombre: 'Uno' }])
  })

  it('las asignaciones descartan las filas incompletas y pasan a camelCase', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({
      data: [
        { user_id: 'u1', empresa_id: 'e1', empresa_nombre: 'Uno', rol_id: 'operador' },
        { user_id: 'u1', empresa_id: 'e2', empresa_nombre: 'Dos' },
        { user_id: 'u2', empresa_id: null, empresa_nombre: 'Tres', rol_id: 'consulta' },
      ],
      error: null,
    } as never)
    expect(await listarAsignaciones()).toEqual([{ userId: 'u1', empresaId: 'e1', empresaNombre: 'Uno', rolId: 'operador' }])
  })

  it('un error de la base sale como Error con su mensaje', async () => {
    vi.mocked(supabaseClient.rpc).mockResolvedValue({ data: null, error: { message: 'sin permiso' } } as never)
    await expect(listarAsignaciones()).rejects.toThrow('sin permiso')
  })
})
