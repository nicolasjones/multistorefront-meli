import { describe, expect, it } from 'vitest'
import bruto from './fixtures/qr-dorados.json?raw'
import { generarQr } from './qr'
import { leerQr } from './qr.lector.test-util'

// Vectores dorados (FR-041a): matrices generadas UNA vez con una implementación de referencia (`qrcode` 1.5.4, instalada
// solo en un contenedor descartable; ver el comando y la versión en el propio archivo) y comparadas módulo a módulo.
type Vector = { texto: string; bytes: number; version: number; mascara: number; modulos: string[] }
const dorados = JSON.parse(bruto) as { referencia: { paquete: string; version: string }; comando: string; vectores: Vector[] }

const aFilas = (modulos: boolean[][]) => modulos.map((fila) => fila.map((oscuro) => (oscuro ? '1' : '0')).join(''))

describe('vectores dorados del generador de QR (FR-041a)', () => {
  it('el archivo declara la referencia y el comando, y trae al menos 8 textos de 40 a 213 bytes (uno con acentos)', () => {
    expect(dorados.referencia).toEqual(expect.objectContaining({ paquete: 'qrcode', version: '1.5.4' }))
    expect(dorados.comando).toMatch(/docker run/)
    expect(dorados.vectores.length).toBeGreaterThanOrEqual(8)
    expect(dorados.vectores.filter((v) => v.bytes >= 40 && v.bytes <= 213).length).toBeGreaterThanOrEqual(8)
    expect(dorados.vectores.some((v) => [...v.texto].some((c) => c.charCodeAt(0) > 127))).toBe(true)
    expect(Math.max(...dorados.vectores.map((v) => v.bytes))).toBe(213)
    // Cubre las 10 versiones y los saltos de versión por tamaño.
    expect(new Set(dorados.vectores.map((v) => v.version)).size).toBe(10)
  })

  for (const [indice, vector] of dorados.vectores.entries()) {
    it(`vector ${indice + 1}: ${vector.bytes} bytes, versión ${vector.version} — misma matriz módulo a módulo con la máscara de la referencia`, () => {
      expect(new TextEncoder().encode(vector.texto).length).toBe(vector.bytes)
      const propio = generarQr(vector.texto, { mascara: vector.mascara })
      expect(propio.version).toBe(vector.version)
      expect(aFilas(propio.modulos)).toEqual(vector.modulos)
      expect(leerQr(propio.modulos).texto).toBe(vector.texto)
    })
  }

  it('con la elección automática de máscara coincide con la referencia en casi todos los vectores', () => {
    // La referencia usa un N4 más estricto que el texto de ISO/IEC 18004 (ceil en lugar de floor): puede elegir otra
    // máscara válida cuando el porcentaje de oscuros cae entre 50 y 55 %. Se tolera como máximo un vector distinto
    // y en ese caso el símbolo igual lee el mismo texto (lo comprueba la prueba de ida y vuelta).
    const distintos = dorados.vectores.filter((v) => JSON.stringify(aFilas(generarQr(v.texto).modulos)) !== JSON.stringify(v.modulos))
    expect(distintos.length).toBeLessThanOrEqual(1)
    for (const v of distintos) expect(leerQr(generarQr(v.texto).modulos).texto).toBe(v.texto)
  })
})
