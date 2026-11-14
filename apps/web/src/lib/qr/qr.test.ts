import { describe, expect, it } from 'vitest'
import fuenteGalois from './galois.ts?raw'
import fuentePlantillas from './plantillas.ts?raw'
import fuenteQr from './qr.ts?raw'
import fuenteSvg from './svg.ts?raw'
import { generadorReedSolomon, multiplicarGf, restoReedSolomon } from './galois'
import {
  CAPACIDAD_MAXIMA_BYTES,
  PLANTILLAS_M,
  VERSION_MAXIMA,
  bitsRemanentes,
  capacidadEnBytes,
  palabrasDeDatos,
  totalDeBloques,
} from './plantillas'
import { MASCARAS, QrDemasiadoLargo, bitsDeFormato, bitsDeVersion, bytesUtf8, generarQr, penalizacion } from './qr'
import { ErrorDeLectura, leerQr } from './qr.lector.test-util'
import { ZONA_QUIETA, qrASvg, qrASvgPath } from './svg'

const aleatorio = (semilla: number) => {
  let s = semilla
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const url = (longitud: number) => ('https://panel.example/service-tecnico/reparaciones/0b6f4c1e-8d2a-4c3b-9a7e-' + 'a'.repeat(300)).slice(0, longitud)

describe('Galois y Reed-Solomon (FR-040)', () => {
  it('multiplica en GF(256) con el polinomio 0x11D', () => {
    expect(multiplicarGf(0, 77)).toBe(0)
    expect(multiplicarGf(1, 77)).toBe(77)
    expect(multiplicarGf(2, 0x80)).toBe(0x1d) // x · x^7 = x^8 = x^4 + x^3 + x^2 + 1
    expect(multiplicarGf(0x53, 0xca)).toBe(multiplicarGf(0xca, 0x53))
  })

  it('el generador de grado 7 coincide con el de la tabla de ISO/IEC 18004 (exponentes de α)', () => {
    // Anexo A del estándar: x^7 + α^87 x^6 + α^229 x^5 + α^146 x^4 + α^149 x^3 + α^238 x^2 + α^102 x + α^21.
    const alfa = (e: number) => {
      let v = 1
      for (let i = 0; i < e; i++) v = multiplicarGf(v, 2)
      return v
    }
    expect(generadorReedSolomon(7)).toEqual([87, 229, 146, 149, 238, 102, 21].map(alfa))
  })

  it('reproduce las palabras de corrección de ejemplos publicados', () => {
    // «HELLO WORLD», versión 1-M (tutorial de Thonky), y el ejemplo clásico de 9 + 17 palabras (Wikiversity/Wikipedia).
    expect(restoReedSolomon([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
    expect(restoReedSolomon([32, 65, 205, 69, 41, 220, 46, 128, 236], 17)).toEqual([42, 159, 74, 221, 244, 169, 239, 150, 138, 70, 237, 85, 224, 96, 74, 219, 61])
  })

  it('rechaza grados fuera de rango', () => {
    expect(() => generadorReedSolomon(0)).toThrow(RangeError)
    expect(() => generadorReedSolomon(256)).toThrow(RangeError)
  })
})

describe('tablas de la versión 1 a 10, corrección M (FR-040)', () => {
  const TOTAL_PALABRAS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]
  const CAPACIDAD_BYTES = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]

  it('datos + corrección por bloque suman las palabras totales del estándar', () => {
    PLANTILLAS_M.forEach((plantilla, i) => {
      expect(plantilla.version).toBe(i + 1)
      expect(palabrasDeDatos(plantilla) + totalDeBloques(plantilla) * plantilla.correccionPorBloque).toBe(TOTAL_PALABRAS[i])
    })
  })

  it('la capacidad en bytes del modo byte es la publicada (14, 26, 42, 62, 84, 106, 122, 152, 180, 213)', () => {
    expect(PLANTILLAS_M.map((_, i) => capacidadEnBytes(i + 1))).toEqual(CAPACIDAD_BYTES)
    expect(CAPACIDAD_MAXIMA_BYTES).toBe(213)
  })

  it('el grupo 2 tiene una palabra de datos más que el grupo 1', () => {
    for (const plantilla of PLANTILLAS_M) {
      if (plantilla.grupo2.bloques > 0) expect(plantilla.grupo2.datos).toBe(plantilla.grupo1.datos + 1)
    }
  })

  it('los módulos de datos del símbolo son las palabras totales por 8 más los bits remanentes', () => {
    for (let version = 1; version <= VERSION_MAXIMA; version++) {
      // El generador lanza si no cierra la cuenta de módulos de datos; acá se recorre cada versión con un texto del largo justo.
      const resultado = generarQr(url(CAPACIDAD_BYTES[version - 1]))
      expect(resultado.version).toBe(version)
      expect(bitsRemanentes(version)).toBe(version >= 2 && version <= 6 ? 7 : 0)
    }
  })
})

describe('generarQr (FR-040)', () => {
  it('el tamaño es 17 + 4 × versión y la versión es la mínima que entra', () => {
    const casos: [number, number][] = [[14, 1], [15, 2], [26, 2], [27, 3], [42, 3], [43, 4], [62, 4], [63, 5], [84, 5], [85, 6], [106, 6], [107, 7], [122, 7], [123, 8], [152, 8], [153, 9], [180, 9], [181, 10], [213, 10]]
    for (const [bytes, version] of casos) {
      const qr = generarQr(url(bytes))
      expect(qr.version, `${bytes} bytes`).toBe(version)
      expect(qr.tamano).toBe(17 + 4 * version)
      expect(qr.modulos).toHaveLength(qr.tamano)
      expect(qr.modulos.every((fila) => fila.length === qr.tamano)).toBe(true)
    }
  })

  it('213 bytes entra y 214 lanza QrDemasiadoLargo, sin truncar', () => {
    expect(generarQr(url(213)).version).toBe(10)
    expect(() => generarQr(url(214))).toThrow(QrDemasiadoLargo)
    try {
      generarQr(url(214))
    } catch (error) {
      expect(error).toBeInstanceOf(QrDemasiadoLargo)
      expect((error as QrDemasiadoLargo).bytes).toBe(214)
      expect((error as QrDemasiadoLargo).maximo).toBe(213)
    }
  })

  it('cuenta bytes UTF-8 y no caracteres', () => {
    const tilde = 'á'.repeat(107) // 214 bytes
    expect(() => generarQr(tilde)).toThrow(QrDemasiadoLargo)
    expect(generarQr('á'.repeat(106)).version).toBe(10) // 212 bytes
    expect(bytesUtf8('añ€😀')).toEqual([...new TextEncoder().encode('añ€😀')])
    expect(bytesUtf8('\ud800x\udc00')).toEqual([...new TextEncoder().encode('\ud800x\udc00')]) // sustitutos sueltos → U+FFFD
  })

  it('dibuja los buscadores, la temporización y el módulo oscuro en su lugar', () => {
    for (const largo of [14, 60, 150, 213]) {
      const { modulos, tamano } = generarQr(url(largo))
      const buscador = (fila0: number, col0: number) => {
        for (let dy = 0; dy < 7; dy++) {
          for (let dx = 0; dx < 7; dx++) {
            const borde = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
            expect(modulos[fila0 + dy][col0 + dx], `buscador ${fila0},${col0} (${dy},${dx})`).toBe(borde !== 2)
          }
        }
      }
      buscador(0, 0)
      buscador(0, tamano - 7)
      buscador(tamano - 7, 0)
      // Separadores claros.
      for (let i = 0; i < 8; i++) {
        expect(modulos[7][i]).toBe(false)
        expect(modulos[i][7]).toBe(false)
        expect(modulos[7][tamano - 1 - i]).toBe(false)
        expect(modulos[i][tamano - 8]).toBe(false)
        expect(modulos[tamano - 8][i]).toBe(false)
        expect(modulos[tamano - 1 - i][7]).toBe(false)
      }
      // Temporización: alterna oscuro/claro entre los buscadores.
      for (let i = 8; i < tamano - 8; i++) {
        expect(modulos[6][i]).toBe(i % 2 === 0)
        expect(modulos[i][6]).toBe(i % 2 === 0)
      }
      expect(modulos[tamano - 8][8]).toBe(true) // módulo oscuro
    }
  })

  it('dibuja los patrones de alineación de cada versión', () => {
    for (const plantilla of PLANTILLAS_M.filter((p) => p.alineacion.length > 0)) {
      const { modulos, tamano } = generarQr(url(capacidadEnBytes(plantilla.version)))
      const ultimo = plantilla.alineacion.length - 1
      plantilla.alineacion.forEach((fila, i) => {
        plantilla.alineacion.forEach((col, j) => {
          if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) return
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              expect(modulos[fila + dy][col + dx], `v${plantilla.version} (${fila},${col})`).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
            }
          }
        })
      })
      expect(tamano).toBe(17 + 4 * plantilla.version)
    }
  })

  it('la información de formato coincide con la tabla publicada de ISO/IEC 18004 (nivel M, máscaras 0 a 7)', () => {
    const PUBLICADA = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000']
    PUBLICADA.forEach((bits, mascara) => {
      expect(bitsDeFormato(mascara).toString(2).padStart(15, '0')).toBe(bits)
      // Y está escrita, en las dos copias, en la matriz.
      const { modulos, tamano } = generarQr(url(30), { mascara })
      const copia1 = [...Array(6).keys()].map((i) => modulos[i][8]).concat(modulos[7][8], modulos[8][8], modulos[8][7], [...Array(6).keys()].map((i) => modulos[8][5 - i]))
      const copia2 = [...Array(8).keys()].map((i) => modulos[8][tamano - 1 - i]).concat([...Array(7).keys()].map((i) => modulos[tamano - 7 + i][8]))
      const esperado = bits.split('').reverse().map((bit) => bit === '1')
      expect(copia1).toEqual(esperado)
      expect(copia2).toEqual(esperado)
    })
  })

  it('la información de versión (7 a 10) coincide con la tabla publicada y está en las dos copias', () => {
    const PUBLICADA: Record<number, string> = { 7: '000111110010010100', 8: '001000010110111100', 9: '001001101010011001', 10: '001010010011010011' }
    for (const [version, bits] of Object.entries(PUBLICADA).map(([v, b]) => [Number(v), b] as const)) {
      expect(bitsDeVersion(version).toString(2).padStart(18, '0')).toBe(bits)
      const { modulos, tamano } = generarQr(url(capacidadEnBytes(version)))
      for (let i = 0; i < 18; i++) {
        const esperado = bits[17 - i] === '1'
        expect(modulos[Math.floor(i / 3)][tamano - 11 + (i % 3)]).toBe(esperado)
        expect(modulos[tamano - 11 + (i % 3)][Math.floor(i / 3)]).toBe(esperado)
      }
    }
  })

  it('es determinista: el mismo texto da la misma matriz', () => {
    const a = generarQr(url(120))
    const b = generarQr(url(120))
    expect(b).toEqual(a)
    expect(generarQr(url(121)).modulos).not.toEqual(a.modulos)
  })

  it('la máscara forzada fuera de 0 a 7 se rechaza y la elegida es la de menor penalización', () => {
    expect(() => generarQr('a', { mascara: 8 })).toThrow(RangeError)
    expect(() => generarQr('a', { mascara: 1.5 })).toThrow(RangeError)
    const texto = url(90)
    const penalizaciones = Array.from({ length: MASCARAS }, (_, m) => penalizacion(generarQr(texto, { mascara: m }).modulos))
    expect(penalizacion(generarQr(texto).modulos)).toBe(Math.min(...penalizaciones))
  })

  it('el texto vacío y los caracteres raros no rompen el generador', () => {
    expect(leerQr(generarQr('').modulos).texto).toBe('')
    for (const texto of ['\u0000', '😀'.repeat(20), '<script>alert(1)</script>', 'a'.repeat(213)]) {
      expect(leerQr(generarQr(texto).modulos).texto).toBe(texto)
    }
  })
})

describe('penalización (ISO/IEC 18004, 8.8.2)', () => {
  const grilla = (n: number, oscuro: (fila: number, col: number) => boolean) => Array.from({ length: n }, (_, fila) => Array.from({ length: n }, (_, col) => oscuro(fila, col)))

  it('suma N1, N2 y N4 en una matriz uniforme', () => {
    // 5×5 toda clara: N1 = 10 corridas de 5 × 3 = 30; N2 = 16 bloques × 3 = 48; N4 = 100 % de desvío → k = 10 → 100.
    expect(penalizacion(grilla(5, () => false))).toBe(30 + 48 + 100)
  })

  it('el tablero de ajedrez no tiene corridas ni bloques y el 52 % de oscuros no penaliza (N4 usa floor)', () => {
    // 5×5: 13 oscuros de 25 = 52 %: dentro de 45–55 % → k = 0 (una referencia que usa ceil daría 10).
    expect(penalizacion(grilla(5, (fila, col) => (fila + col) % 2 === 0))).toBe(0)
  })

  it('N4 suma 10 por cada tramo de 5 % de desvío', () => {
    // 4×4 ajedrez con un oscuro menos: 7 de 16 = 43,75 % → desvío 6,25 % → k = 1.
    expect(penalizacion(grilla(4, (fila, col) => (fila + col) % 2 === 0 && !(fila === 0 && col === 0)))).toBe(10)
  })

  it('N3 suma 40 por cada patrón 1:1:3:1:1 con cuatro claros a un lado', () => {
    // Una fila 11 de ancho con el patrón 10111010000 y el resto alternado para no producir otras penalizaciones.
    const fila = [true, false, true, true, true, false, true, false, false, false, false]
    const m = grilla(11, (f, c) => (f === 5 ? fila[c] : (f + c) % 2 === 0))
    const base = penalizacion(grilla(11, (f, c) => (f + c) % 2 === 0))
    expect(penalizacion(m)).toBeGreaterThanOrEqual(base + 40)
  })
})

describe('ida y vuelta con el lector de prueba (FR-041b)', () => {
  const ALFABETO = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~:/?#[]@!$&()*+,;=%ñáéíóúü€漢字😀']

  it('reconstruye el mismo texto en 200 casos con semilla fija (1 a 213 bytes, ASCII y UTF-8)', () => {
    const rnd = aleatorio(20261114)
    let versiones = new Set<number>()
    for (let caso = 0; caso < 200; caso++) {
      const objetivo = 1 + Math.floor(rnd() * 213)
      const universo = caso % 2 === 0 ? 70 : ALFABETO.length // los pares son ASCII; los impares mezclan UTF-8
      let texto = ''
      for (;;) {
        const caracter = ALFABETO[Math.floor(rnd() * universo)]
        if (bytesUtf8(texto + caracter).length > objetivo) break
        texto += caracter
      }
      if (texto === '') texto = 'a'
      const qr = generarQr(texto)
      const lectura = leerQr(qr.modulos)
      expect(lectura.texto, `caso ${caso}`).toBe(texto)
      expect(lectura.version).toBe(qr.version)
      expect(lectura.sindromesNulos).toBeGreaterThan(0)
      versiones = versiones.add(qr.version)
    }
    expect([...versiones].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('lee cada versión con cada una de las 8 máscaras y detecta la máscara', () => {
    for (let version = 1; version <= 10; version++) {
      const texto = url(capacidadEnBytes(version))
      for (let mascara = 0; mascara < MASCARAS; mascara++) {
        const lectura = leerQr(generarQr(texto, { mascara }).modulos)
        expect(lectura.texto).toBe(texto)
        expect(lectura.mascara).toBe(mascara)
      }
    }
  })

  it('falla si se invierte un módulo de datos', () => {
    for (const largo of [20, 90, 213]) {
      const qr = generarQr(url(largo))
      expect(leerQr(qr.modulos).texto).toBe(url(largo))
      const alterada = qr.modulos.map((fila) => [...fila])
      alterada[qr.tamano - 1][qr.tamano - 1] = !alterada[qr.tamano - 1][qr.tamano - 1] // primer módulo del zigzag: siempre es de datos
      expect(() => leerQr(alterada)).toThrow(ErrorDeLectura)
    }
  })

  it('falla si se invierte un módulo de la información de formato o de versión', () => {
    const qr = generarQr(url(213))
    const formato = qr.modulos.map((fila) => [...fila])
    formato[8][2] = !formato[8][2]
    expect(() => leerQr(formato)).toThrow(ErrorDeLectura)
    const version = qr.modulos.map((fila) => [...fila])
    version[0][qr.tamano - 11] = !version[0][qr.tamano - 11]
    expect(() => leerQr(version)).toThrow(ErrorDeLectura)
  })

  it('el lector rechaza matrices que no son un QR', () => {
    expect(() => leerQr([[true]])).toThrow(ErrorDeLectura)
    expect(() => leerQr(Array.from({ length: 21 }, () => new Array<boolean>(21).fill(false)))).toThrow(ErrorDeLectura)
  })
})

describe('qrASvgPath (FR-040)', () => {
  // Re-rasteriza el `path` (solo `M x y h largo v1 h-largo z`) y lo compara módulo a módulo con la matriz.
  function rasterizar(path: string, lado: number): boolean[][] {
    const matriz = Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false))
    const comandos = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)]
    expect(comandos.map((c) => c[0]).join('')).toBe(path) // no hay nada más que corridas
    for (const [, x, y, largo, atras] of comandos) {
      expect(atras).toBe(largo)
      for (let i = 0; i < Number(largo); i++) matriz[Number(y)][Number(x) + i] = true
    }
    return matriz
  }

  it('reproduce exactamente la matriz con zona quieta de 4 módulos y viewBox = tamaño + 8', () => {
    for (const largo of [14, 100, 213]) {
      const qr = generarQr(url(largo))
      const svg = qrASvg(qr.modulos, { zonaQuieta: 4 })
      expect(svg.lado).toBe(qr.tamano + 8)
      expect(svg.viewBox).toBe(`0 0 ${qr.tamano + 8} ${qr.tamano + 8}`)
      const raster = rasterizar(svg.path, svg.lado)
      for (let y = 0; y < svg.lado; y++) {
        for (let x = 0; x < svg.lado; x++) {
          const dentro = x >= 4 && y >= 4 && x < 4 + qr.tamano && y < 4 + qr.tamano
          expect(raster[y][x]).toBe(dentro ? qr.modulos[y - 4][x - 4] : false)
        }
      }
      expect(qrASvgPath(qr.modulos, { zonaQuieta: 4 })).toBe(svg.path)
      expect(qrASvgPath(qr.modulos)).toBe(svg.path) // la zona quieta por omisión es 4
      expect(ZONA_QUIETA).toBe(4)
    }
  })

  it('usa coordenadas enteras, fusiona las corridas y no mete HTML', () => {
    const { path } = qrASvg([[true, true, false, true], [false, false, false, false], [false, false, false, false], [false, false, false, false]], { zonaQuieta: 0 })
    expect(path).toBe('M0 0h2v1h-2zM3 0h1v1h-1z')
    expect(path).not.toMatch(/[<>"']|\d\.\d/)
  })

  it('rechaza una zona quieta inválida', () => {
    expect(() => qrASvg([[true]], { zonaQuieta: -1 })).toThrow(RangeError)
    expect(() => qrASvg([[true]], { zonaQuieta: 1.5 })).toThrow(RangeError)
  })
})

describe('el generador es puro (FR-040, amenaza 3.6)', () => {
  it('ningún archivo del generador usa DOM, red, eval, Function ni dependencias', () => {
    for (const [nombre, fuente] of Object.entries({ galois: fuenteGalois, plantillas: fuentePlantillas, qr: fuenteQr, svg: fuenteSvg })) {
      const sinComentarios = fuente.replace(/\/\/.*$/gm, '')
      expect(sinComentarios, nombre).not.toMatch(/\b(document|window|navigator|localStorage|fetch|XMLHttpRequest|eval|WebSocket|dangerouslySetInnerHTML)\b/)
      expect(sinComentarios, nombre).not.toMatch(/\bnew Function\b|\bFunction\(/)
      // Solo importan a sus hermanos: ningún paquete.
      for (const [, origen] of sinComentarios.matchAll(/from '([^']+)'/g)) expect(origen, nombre).toMatch(/^\.\//)
    }
  })
})
