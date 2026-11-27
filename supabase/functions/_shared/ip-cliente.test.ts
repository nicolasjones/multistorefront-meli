// Pruebas de `ip-cliente.ts` (MSF-980). Corre con `node --test`.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ipDelCliente, saltosDeProxy, SIN_IP } from './ip-cliente.ts'

const con = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff })

describe('ipDelCliente', () => {
  it('toma el último valor de la cadena (lo que agrega el proxy más cercano), no el primero que puede falsificar quien llama', () => {
    assert.equal(ipDelCliente(con('9.9.9.9, 10.2.3.4'), 0), '10.2.3.4')
    assert.equal(ipDelCliente(con('10.2.3.4'), 0), '10.2.3.4')
  })

  it('descuenta los saltos de proxy de confianza: n-1 / n / n+1 sobre una cadena de 3 (los equivalentes por encima del largo caen al primero)', () => {
    const cadena = con('1.1.1.1, 2.2.2.2, 3.3.3.3')
    assert.equal(ipDelCliente(cadena, 0), '3.3.3.3')
    assert.equal(ipDelCliente(cadena, 1), '2.2.2.2')
    assert.equal(ipDelCliente(cadena, 2), '1.1.1.1')
    assert.equal(ipDelCliente(cadena, 3), '1.1.1.1')
    assert.equal(ipDelCliente(cadena, 10), '1.1.1.1')
  })

  it('sin cabecera, vacía o con valores en blanco devuelve sin-ip', () => {
    assert.equal(ipDelCliente(con(), 0), SIN_IP)
    assert.equal(ipDelCliente(con(''), 0), SIN_IP)
    assert.equal(ipDelCliente(con('   '), 0), SIN_IP)
    assert.equal(ipDelCliente(con('1.1.1.1, '), 0), SIN_IP)
  })

  it('tolera espacios alrededor de cada valor', () => {
    assert.equal(ipDelCliente(con('  1.1.1.1 ,   2.2.2.2  '), 0), '2.2.2.2')
  })

  it('acota el valor a 64 caracteres (borde: 64 entra entero, 65 se recorta)', () => {
    assert.equal(ipDelCliente(con('a'.repeat(64)), 0), 'a'.repeat(64))
    assert.equal(ipDelCliente(con('a'.repeat(65)), 0), 'a'.repeat(64))
  })

  it('un salto negativo o decimal no rompe: se trata como 0 o se trunca', () => {
    assert.equal(ipDelCliente(con('1.1.1.1, 2.2.2.2'), -3), '2.2.2.2')
    assert.equal(ipDelCliente(con('1.1.1.1, 2.2.2.2, 3.3.3.3'), 1.9), '2.2.2.2')
  })
})

describe('saltosDeProxy', () => {
  it('lee un entero de 0 a 10 y cualquier otra cosa vale 0 (tabla: n-1 / n / n+1)', () => {
    const casos: [string | undefined, number][] = [
      [undefined, 0], ['', 0], ['  ', 0], ['0', 0], ['1', 1], ['9', 9], ['10', 10], ['11', 0], ['-1', 0], ['1.5', 0], ['uno', 0], ['NaN', 0], ['Infinity', 0],
    ]
    for (const [valor, esperado] of casos) assert.equal(saltosDeProxy(valor), esperado, String(valor))
  })
})
