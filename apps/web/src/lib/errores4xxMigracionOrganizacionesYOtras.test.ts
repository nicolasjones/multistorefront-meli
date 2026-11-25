import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc, from: vi.fn() } }))

import { mensajeDeErrorMigracion } from './migracion'
import { cambiarEstadoCuentaWeb } from './cuentasCliente'
import { mensajeDeErrorItem } from './reparacionItems'
import { mensajeDeErrorRentabilidad, MENSAJE_CONFLICTO_UMBRAL } from './rentabilidad'
import { exportarProveedores } from './exportarProveedores'
import { esConflictoOpinion, mensajeDeErrorOpiniones, MENSAJE_CONFLICTO_OPINION } from './opiniones'

// Decimoquinta ola (MSF-599): el servidor contesta `PT404` (404) donde antes contestaba `P0002` (500) y `PT412` (412) donde antes
// contestaba `40001`. Migración y despliegue de la web no son simultáneos: el cliente muestra lo mismo con los dos códigos.
const NO_EXISTE = ['P0002', 'PT404']
const CONFLICTO = ['40001', 'PT412']

describe('decimoquinta ola: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(NO_EXISTE)('cargas de migración (%s): la carga ya no existe', (code) => {
    expect(mensajeDeErrorMigracion({ code, message: 'texto crudo' }, 'No pudimos importar.')).toBe('La carga ya no existe en tu organización.')
  })

  it.each(NO_EXISTE)('cuentas web de clientes (%s): el cliente o la cuenta ya no existen', async (code) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'texto crudo' } })
    await expect(cambiarEstadoCuentaWeb('c-1', 'e-1', 'suspendida')).rejects.toThrow('El cliente o la cuenta ya no existen.')
  })

  it.each(NO_EXISTE)('ítems de reparaciones y depósitos de repuestos (%s): ya no existe', (code) => {
    expect(mensajeDeErrorItem({ code, message: 'texto crudo' }, 'No pudimos.')).toBe('La reparación o el ítem ya no existe. Recargá la página.')
  })

  it.each(CONFLICTO)('umbral de margen (%s): lo modificó otra persona', (code) => {
    expect(mensajeDeErrorRentabilidad({ code })).toBe(MENSAJE_CONFLICTO_UMBRAL)
  })

  it.each(CONFLICTO)('exportación de proveedores (%s): los proveedores cambiaron', async (code) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'texto crudo' } })
    await expect(
      exportarProveedores({ texto: '', estado: 'activos', empresaId: null }, { alProgresar: () => undefined }),
    ).rejects.toThrow('Los proveedores cambiaron mientras se exportaba. Intentá de nuevo.')
  })

  it.each(CONFLICTO)('moderación de opiniones (%s): la opinión cambió mientras la mirabas', (code) => {
    expect(esConflictoOpinion({ code })).toBe(true)
    expect(mensajeDeErrorOpiniones({ code, message: 'conflicto' }, 'No pudimos.')).toBe(MENSAJE_CONFLICTO_OPINION)
  })

  it('moderación de opiniones: otros códigos no son conflicto', () => {
    expect(esConflictoOpinion({ code: '42501' })).toBe(false)
    expect(esConflictoOpinion(null)).toBe(false)
  })
})
