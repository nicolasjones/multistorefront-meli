import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabaseClient: { rpc: vi.fn(), from: vi.fn() } }))

import { mensajeDeErrorGasto } from './gastos'
import { ErrorConsulta, esConflicto as esConflictoConsulta, mensajeDeError as mensajeDeErrorConsulta } from './consultas'
import { ErrorContacto, esConflicto as esConflictoContacto, mensajeDeError as mensajeDeErrorContacto } from './contactos'
import { mensajeDeErrorCorreoAvisos } from '../hooks/useCorreoAvisosConsultas'
import {
  MENSAJE_CONFLICTO_ESTADO_RMA,
  MENSAJE_ERROR_CAMBIO_ESTADO_RMA,
  MENSAJE_ERROR_RESOLVER_RMA,
  mensajeDeCambioEstadoRma,
  mensajeDeResolucionRma,
  mensajeDeRma,
} from './rma'
import { mensajeDeNotaCredito } from './notaCredito'
import { mensajeDeErrorRendicion } from './ventas/enviosMotoRendicion'
import { mensajeDeFacturarPresupuesto } from './ventasPresupuestos'
import { mensajeDeErrorLista } from './listas'

// Décima ola (MSF-599): el servidor contesta `PT404` (404), `PT412` (412) y `PT409` (409) donde antes contestaba `P0002`,
// `40001` y `55000` (500). Migración y despliegue de la web no son simultáneos: el cliente muestra lo mismo con los dos códigos.
const NO_EXISTE = ['P0002', 'PT404']
const CONFLICTO = ['40001', 'PT412']
const ESTADO = ['55000', 'PT409']

describe('décima ola: el código viejo y el nuevo se tratan igual', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it.each(NO_EXISTE)('gastos (%s): el gasto ya no existe', (code) => {
    expect(mensajeDeErrorGasto({ code })).toBe('El gasto o la tienda ya no existen. Recargá la lista.')
  })
  it.each(CONFLICTO)('gastos (%s): otra persona cambió el gasto', (code) => {
    expect(mensajeDeErrorGasto({ code })).toMatch(/Otra persona cambió este gasto/)
  })

  it.each(CONFLICTO)('consultas (%s): conflicto de edición', (code) => {
    const error = new ErrorConsulta('texto crudo', code)
    expect(esConflictoConsulta(error)).toBe(true)
    expect(mensajeDeErrorConsulta(error, 'x')).toMatch(/Otra persona modificó esta consulta/)
  })
  it('consultas: otro código no es un conflicto', () => {
    expect(esConflictoConsulta(new ErrorConsulta('x', '42501'))).toBe(false)
  })

  it.each(CONFLICTO)('contactos (%s): conflicto de edición', (code) => {
    const error = new ErrorContacto('texto crudo', code, null)
    expect(esConflictoContacto(error)).toBe(true)
    expect(mensajeDeErrorContacto(error, 'x')).toMatch(/Otra persona modificó este contacto/)
  })
  it('contactos: otro código no es un conflicto', () => {
    expect(esConflictoContacto(new ErrorContacto('x', '23505', null))).toBe(false)
  })

  it.each(CONFLICTO)('correo de avisos (%s): conflicto de edición', (code) => {
    expect(mensajeDeErrorCorreoAvisos({ code })).toMatch(/Otra persona modificó la dirección de avisos/)
  })

  it.each(ESTADO)('registrar devolución (%s): muestra el texto de la RPC', (code) => {
    expect(mensajeDeRma({ code, message: 'La factura está anulada: no admite devoluciones' })).toBe('La factura está anulada: no admite devoluciones')
  })
  it.each(ESTADO)('registrar devolución (%s): un texto desconocido cae al genérico', (code) => {
    expect(mensajeDeRma({ code, message: 'select * from secretos' })).not.toMatch(/secretos/)
  })
  it.each(NO_EXISTE)('registrar devolución (%s): la factura no existe', (code) => {
    expect(mensajeDeRma({ code, message: 'El comprobante no existe' })).toMatch(/no existe o no pertenece/)
  })

  it.each(CONFLICTO)('cambiar estado de devolución (%s): conflicto', (code) => {
    expect(mensajeDeCambioEstadoRma({ code })).toBe(MENSAJE_CONFLICTO_ESTADO_RMA)
  })
  it.each(NO_EXISTE)('cambiar estado de devolución (%s): ya no existe', (code) => {
    expect(mensajeDeCambioEstadoRma({ code })).toBe('Esa devolución ya no existe. Actualizamos el listado.')
  })
  it('cambiar estado de devolución: un código desconocido cae al genérico', () => {
    expect(mensajeDeCambioEstadoRma({ code: 'XX000' })).toBe(MENSAJE_ERROR_CAMBIO_ESTADO_RMA)
  })

  it.each(ESTADO)('resolver devolución (%s): muestra el texto de la RPC', (code) => {
    expect(mensajeDeResolucionRma({ code, message: 'La devolución ya se resolvió con reingreso de stock' })).toBe(
      'La devolución ya se resolvió con reingreso de stock',
    )
  })
  it.each(ESTADO)('resolver devolución (%s): un texto desconocido cae al genérico', (code) => {
    expect(mensajeDeResolucionRma({ code, message: 'select * from secretos' })).toBe(MENSAJE_ERROR_RESOLVER_RMA)
  })
  it.each(NO_EXISTE)('resolver devolución (%s): ya no existe', (code) => {
    expect(mensajeDeResolucionRma({ code, message: 'La devolución no existe' })).toBe('Esa devolución ya no existe. Actualizamos el listado.')
  })

  it.each(ESTADO)('nota de crédito (%s): muestra el texto de la RPC', (code) => {
    expect(mensajeDeNotaCredito({ code, message: 'La factura está anulada: no admite notas de crédito' })).toBe(
      'La factura está anulada: no admite notas de crédito',
    )
  })

  it.each(ESTADO)('rendición de envíos en moto (%s): muestra el mensaje de la base', (code) => {
    const message = 'La factura 0001-00000002 fue anulada: su envío en moto no se puede rendir, no se rindió ninguno'
    expect(mensajeDeErrorRendicion({ code, message }, 'x')).toBe(message)
  })
  it.each(CONFLICTO)('rendición de envíos en moto (%s): conflicto', (code) => {
    expect(mensajeDeErrorRendicion({ code }, 'x')).toMatch(/Otra persona modificó estos envíos/)
  })

  it.each(ESTADO)('facturar presupuesto (%s): muestra el texto fijo de la RPC', (code) => {
    expect(mensajeDeFacturarPresupuesto({ code, message: 'Aceptá el presupuesto antes de facturarlo' }, 'x')).toBe('Aceptá el presupuesto antes de facturarlo')
  })
  it.each(ESTADO)('facturar presupuesto (%s): un texto desconocido no se muestra', (code) => {
    expect(mensajeDeFacturarPresupuesto({ code, message: 'select * from secretos' }, 'genérico')).not.toMatch(/secretos/)
  })

  it.each(NO_EXISTE)('estados de consulta (%s): el estado ya no existe', (code) => {
    expect(mensajeDeErrorLista({ code }, 'x')).toBe('El estado ya no existe. Recargá la lista.')
  })
})
