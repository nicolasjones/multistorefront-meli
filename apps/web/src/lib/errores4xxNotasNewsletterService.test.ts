import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn(), from: vi.fn() } }))

import { mensajeDeErrorConfirmacion, MENSAJE_COTIZACION_VENCIDA } from './cotizacion'
import { mensajeDeNotaCredito } from './notaCredito'
import { textoErrorNewsletter } from './newsletter'
import { esConflictoDeEdicion, mensajeDeErrorReparacion } from './reparaciones'
import { mensajeDeGenerarComprobante } from './reparacionComprobante'
import { mensajeDeErrorGarantia } from './reparacionGarantia'
import { mensajeDeFacturarPresupuesto } from './ventasPresupuestos'

// Undécima ola (MSF-599): el servidor contesta `PT404` (404), `PT412` (412) y `PT409` (409) donde antes contestaba `P0002`,
// `40001` y `55000` (500). Migración y despliegue de la web no son simultáneos: el cliente muestra lo mismo con los dos códigos.
const NO_EXISTE = ['P0002', 'PT404']
const CONFLICTO = ['40001', 'PT412']
const ESTADO = ['55000', 'PT409']

describe('undécima ola: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(NO_EXISTE)('nota de crédito (%s): la factura ya no existe', (code) => {
    expect(mensajeDeNotaCredito({ code, message: 'texto crudo' })).toBe('Esa factura no existe o no pertenece a tu organización.')
  })

  it.each(NO_EXISTE)('facturar presupuesto (%s): el presupuesto ya no existe', (code) => {
    expect(mensajeDeFacturarPresupuesto({ code, message: 'texto crudo' }, 'x')).toMatch(/no existe o no pertenece a tu organización/)
  })

  it.each(NO_EXISTE)('confirmar cotización (%s): ya no hay cotización pendiente', (code) => {
    expect(mensajeDeErrorConfirmacion({ code })).toBe(MENSAJE_COTIZACION_VENCIDA)
  })

  it.each(CONFLICTO)('newsletter (%s): el borrador cambió', (code) => {
    expect(textoErrorNewsletter({ code, message: 'texto crudo' })).toBe('El borrador cambió desde otra pestaña. Recargá para ver la última versión.')
  })
  it.each(ESTADO)('newsletter (%s): no habilitado o ya enviado', (code) => {
    expect(textoErrorNewsletter({ code, message: 'texto crudo' })).toBe('El newsletter no está habilitado o este envío ya salió.')
  })

  it.each(NO_EXISTE)('reparaciones (%s): la reparación ya no existe', (code) => {
    expect(mensajeDeErrorReparacion({ code }, 'x')).toBe('Esa reparación ya no existe. Volvé al listado.')
    expect(mensajeDeErrorGarantia({ code }, 'x')).toMatch(/ya no existe/)
    expect(mensajeDeGenerarComprobante({ code })).toMatch(/ya no existe|no existe/i)
  })
  it.each(CONFLICTO)('reparaciones (%s): conflicto de edición', (code) => {
    expect(esConflictoDeEdicion({ code })).toBe(true)
    expect(mensajeDeErrorReparacion({ code }, 'x')).toMatch(/modific/i)
  })
  it.each(ESTADO)('reparaciones (%s): anulada o ya entregada', (code) => {
    const base = mensajeDeErrorReparacion({ code }, 'x')
    expect(base).not.toBe('x')
    expect(mensajeDeErrorGarantia({ code }, 'x')).toBe('Solo se puede reingresar por garantía una reparación entregada y no anulada.')
    expect(mensajeDeGenerarComprobante({ code })).not.toMatch(/No pudimos/)
  })

  it('otro código no es un conflicto ni un estado', () => {
    expect(esConflictoDeEdicion({ code: '42501' })).toBe(false)
    expect(mensajeDeErrorReparacion({ code: 'XX000' }, 'por defecto')).toBe('por defecto')
  })
})
