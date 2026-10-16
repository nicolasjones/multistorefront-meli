import { describe, expect, it } from 'vitest'
import { FORMULARIO_CLIENTE_VACIO, aValores, esDocumentoRepetido, validarCliente } from './clientes'

describe('clientes', () => {
  it('validarCliente exige nombre y respeta largos', () => {
    expect(validarCliente({ ...FORMULARIO_CLIENTE_VACIO, nombre: '  ' }).nombre).toBeTruthy()
    expect(validarCliente({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'x'.repeat(201) }).nombre).toBe('Máximo 200 caracteres.')
    expect(validarCliente({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ok' })).toEqual({})
  })

  it('aValores recorta y manda null en los opcionales vacíos', () => {
    expect(aValores({ ...FORMULARIO_CLIENTE_VACIO, nombre: ' Ana ', documento: '  ' })).toMatchObject({ nombre: 'Ana', documento: null })
  })

  it('esDocumentoRepetido reconoce solo el índice de documento', () => {
    expect(esDocumentoRepetido({ code: '23505', message: 'duplicate key ... "clientes_org_documento_uq"' })).toBe(true)
    expect(esDocumentoRepetido({ code: '23505', message: 'duplicate key ... "clientes_org_numero_uq"' })).toBe(false)
    expect(esDocumentoRepetido(new Error('otra cosa'))).toBe(false)
    expect(esDocumentoRepetido(null)).toBe(false)
  })
})
