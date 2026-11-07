import { describe, expect, it } from 'vitest'
import { armarEtiqueta, armarEtiquetas, avisoOmitidos, faltantes, idsDeParametro, rutaEtiquetas, type DatosEtiquetaCliente } from './etiquetasCliente'

const completo: DatosEtiquetaCliente = {
  id: '11111111-1111-4111-8111-111111111111', nombre: 'Distribuidora Norte SRL', direccion: 'Av. Siempre Viva 742', codigo_postal: '2000',
  localidad: 'Rosario', provincia: 'Santa Fe', telefono: '341 555 0101', expreso_preferido: 'Vía Cargo',
}
const sinDireccion: DatosEtiquetaCliente = { ...completo, id: '22222222-2222-4222-8222-222222222222', nombre: 'Sin Calle SA', direccion: '  ' }

describe('etiquetas de cliente (FR-001, FR-002)', () => {
  it('arma la etiqueta con dirección, CP y localidad, provincia, teléfono y transporte', () => {
    expect(armarEtiqueta(completo)).toEqual({
      id: completo.id,
      nombre: 'Distribuidora Norte SRL',
      lineas: ['Av. Siempre Viva 742', '2000 Rosario', 'Santa Fe', 'Tel. 341 555 0101', 'Transporte: Vía Cargo'],
    })
  })

  it('omite los datos opcionales vacíos sin bloquear', () => {
    const etiqueta = armarEtiqueta({ ...completo, codigo_postal: null, provincia: '', telefono: null, expreso_preferido: null })
    expect(etiqueta?.lineas).toEqual(['Av. Siempre Viva 742', 'Rosario'])
  })

  it('CA-CLI-17-1: sin dirección bloquea y nombra el dato que falta', () => {
    expect(faltantes(sinDireccion)).toEqual(['dirección'])
    expect(faltantes({ ...completo, direccion: null })).toEqual(['dirección'])
    expect(armarEtiqueta(sinDireccion)).toBeNull()
    expect(faltantes({ ...completo, localidad: null, telefono: null })).toEqual([])
  })

  it('en una selección separa aptos y omitidos, y el aviso nombra a cada omitido', () => {
    const { aptas, omitidos } = armarEtiquetas([completo, sinDireccion])
    expect(aptas.map((e) => e.id)).toEqual([completo.id])
    expect(omitidos).toEqual([{ id: sinDireccion.id, nombre: 'Sin Calle SA', faltantes: ['dirección'] }])
    expect(avisoOmitidos(omitidos)).toBe('Sin Calle SA (falta dirección)')
  })

  it('si ninguno es apto no hay etiquetas', () => {
    expect(armarEtiquetas([sinDireccion]).aptas).toEqual([])
  })

  it('la ruta lleva los ids y el parámetro descarta entradas inválidas y repetidas', () => {
    expect(rutaEtiquetas([completo.id, sinDireccion.id])).toBe(`/clientes/etiquetas?ids=${completo.id},${sinDireccion.id}`)
    expect(idsDeParametro(`${completo.id},${completo.id},no-es-uuid,1;drop table`)).toEqual([completo.id])
    expect(idsDeParametro(null)).toEqual([])
  })
})
