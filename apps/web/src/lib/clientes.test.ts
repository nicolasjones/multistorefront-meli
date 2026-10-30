import { describe, expect, it } from 'vitest'
import { type Cliente, FORMULARIO_CLIENTE_VACIO, aFormulario, aValores, esDocumentoRepetido, validarCliente } from './clientes'

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

describe('tipo de cliente', () => {
  it('el formulario vacío arranca minorista y aValores envía el tipo', () => {
    expect(FORMULARIO_CLIENTE_VACIO.tipo).toBe('minorista')
    expect(aValores({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', tipo: 'mayorista' }).tipo).toBe('mayorista')
  })
})

describe('relación con empresas (F-CLI-05)', () => {
  const cliente: Cliente = {
    id: 'c-1', numero: 1, nombre: 'Ana', documento: null, correo: null, telefono: null, celular: null,
    direccion: null, codigo_postal: null, localidad: null, provincia: null, expreso_preferido: null,
    archivado_en: null, tipo: 'minorista', es_consumidor_final: false, acepta_correo_masivo: false, created_at: '2026-10-18T00:00:00Z',
  }

  it('aFormulario adjunta las tiendas del cliente (ids) sin mezclarlas con la ficha', () => {
    const formulario = aFormulario(cliente, ['e-1', 'e-2'])
    expect(formulario.empresas).toEqual(['e-1', 'e-2'])
    expect(formulario.nombre).toBe('Ana')
    expect(formulario.documento).toBe('')
  })

  it('aValores devuelve las tiendas aparte de las columnas de clientes', () => {
    const valores = aValores({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', empresas: ['e-1'] })
    expect(valores.empresas).toEqual(['e-1'])
    expect(valores.nombre).toBe('Ana')
  })

  it('el alta nace con el correo masivo encendido y aValores lo envía como acepta_correo_masivo', () => {
    expect(FORMULARIO_CLIENTE_VACIO.aceptaCorreoMasivo).toBe(true)
    expect(aValores({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana' }).acepta_correo_masivo).toBe(true)
    expect(aValores({ ...FORMULARIO_CLIENTE_VACIO, nombre: 'Ana', aceptaCorreoMasivo: false }).acepta_correo_masivo).toBe(false)
  })

  it('aFormulario conserva la aceptación guardada del cliente', () => {
    expect(aFormulario({ ...cliente, acepta_correo_masivo: false }).aceptaCorreoMasivo).toBe(false)
    expect(aFormulario({ ...cliente, acepta_correo_masivo: true }).aceptaCorreoMasivo).toBe(true)
  })
})
