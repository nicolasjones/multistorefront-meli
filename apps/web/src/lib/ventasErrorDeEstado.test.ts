import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))

import { mensajeDeErrorBase } from './mensajeErrorBase'
import { MENSAJE_CERRADO, mensajeDeErrorComprobante } from './ventas'
import { mensajeDeConfirmacion } from './ventasConfirmacion'
import { mensajeDeAnulacion } from './anularComprobante'
import { mensajeDeCambioEstado } from './estadosComprobante'
import { mensajeDeErrorDespacho } from './ventasDespacho'
import { mensajeDeErrorEnvio } from './ventasEnvio'
import { MENSAJE_FUERA_DE_ESTADO, mensajeDeErrorFaltantes } from './ventasFaltantes'
import { mensajeDeErrorCobro, mensajeDeErrorReversion } from './ventas/cobros'
import { mensajeDeErrorEnvioMoto } from './ventas/enviosMoto'
import { mensajeDeErrorContrarreembolso } from './ventas/contrarreembolsos'

// El servidor contesta `PT409` (HTTP 409) donde antes contestaba `55000` (HTTP 500) cuando el estado o la regla de negocio no
// admite la acción. Migración y despliegue de la web no son simultáneos: el cliente muestra lo mismo con los dos códigos.
const CODIGOS = ['55000', 'PT409']

describe('errores de estado de negocio: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(CODIGOS)('catálogo base (%s): texto de estado, nunca el genérico', (code) => {
    expect(mensajeDeErrorBase({ code }, 'genérico')).toMatch(/estado actual/)
  })

  it.each(CODIGOS)('comprobantes (%s): cerrado, también al confirmar', (code) => {
    expect(mensajeDeErrorComprobante({ code }, 'x')).toBe(MENSAJE_CERRADO)
    expect(mensajeDeConfirmacion({ code })).toBe(MENSAJE_CERRADO)
  })

  it.each(CODIGOS)('anulación (%s): muestra el texto fijo de la RPC, no el del servidor', (code) => {
    expect(mensajeDeAnulacion({ code, message: 'La factura ya fue entregada: corregí con nota de crédito o RMA — id 123' }))
      .toBe('La factura ya fue entregada: corregí con nota de crédito o RMA')
  })

  it.each(CODIGOS)('cambio de estado (%s): mensaje de la RPC y, si es desconocido, el genérico', (code) => {
    const borrador = 'La factura está en borrador: confirmala antes de cambiar su estado'
    expect(mensajeDeCambioEstado({ code, message: borrador })).toBe(borrador)
    expect(mensajeDeCambioEstado({ code, message: 'unexpected technical detail' })).not.toContain('technical')
  })

  it.each(CODIGOS)('despacho (%s): mensaje de la RPC y, si es desconocido, el genérico', (code) => {
    const anulada = 'Solo las facturas vigentes (no anuladas ni sin confirmar) se despachan'
    expect(mensajeDeErrorDespacho({ code, message: anulada })).toBe(anulada)
    expect(mensajeDeErrorDespacho({ code, message: 'relation x does not exist' })).not.toContain('relation')
  })

  it.each(CODIGOS)('envío (%s): mensaje de la RPC y, si es desconocido, el genérico', (code) => {
    const entregada = 'Esta factura ya fue entregada: no se puede cambiar el envío'
    expect(mensajeDeErrorEnvio({ code, message: entregada })).toBe(entregada)
    expect(mensajeDeErrorEnvio({ code, message: 'relation x does not exist' })).not.toContain('relation')
  })

  it.each(CODIGOS)('faltantes (%s): fuera de estado', (code) => {
    expect(mensajeDeErrorFaltantes({ code }, 'x')).toBe(MENSAJE_FUERA_DE_ESTADO)
  })

  it.each(CODIGOS)('cobros (%s): no admite cobros; la reversión muestra el mensaje de la base', (code) => {
    expect(mensajeDeErrorCobro({ code }, 'x')).toBe('Esta factura no admite cobros: está en borrador o anulada.')
    expect(mensajeDeErrorReversion({ code, message: 'El cobro ya fue revertido' }, 'por defecto')).toBe('El cobro ya fue revertido')
  })

  it.each(CODIGOS)('envío en moto (%s): mensaje de la base o texto de solo lectura', (code) => {
    expect(mensajeDeErrorEnvioMoto({ code, message: 'La factura está anulada' }, 'x')).toBe('La factura está anulada')
    expect(mensajeDeErrorEnvioMoto({ code }, 'x')).toContain('solo lectura')
  })

  it.each(CODIGOS)('contrarreembolso (%s): factura anulada', (code) => {
    expect(mensajeDeErrorContrarreembolso({ code }, 'x')).toMatch(/anulada/)
  })
})
