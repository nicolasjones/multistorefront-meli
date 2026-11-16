import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLAVE_PREFERENCIA, MARGEN_MM, PREFERENCIA_PREDETERMINADA, TAMANOS_ETIQUETA, altoValido, anchoValido, copiasValidas, disposicionDe,
  distribucionDeEtiqueta, esEntornoDePrueba, etiquetaDemasiadoChica, guardarPreferencia, ladoDelQrMm, leerPreferencia, medidasDeTamano,
  mmPorModulo, textosDeEtiqueta, urlEtiquetaReparacion, FRACCION_MAXIMA_QR,
} from './etiquetaReparacion'
import { QrDemasiadoLargo, generarQr } from './qr/qr'

const ID = '0b6f4c1e-8d2a-4c3b-9a7e-5f2d1c0a9b87'

describe('urlEtiquetaReparacion (FR-042, amenazas 3.1 y 3.3)', () => {
  it('devuelve exactamente origen + /service-tecnico/reparaciones/ + id', () => {
    expect(urlEtiquetaReparacion('https://panel.msf.example', ID)).toBe(`https://panel.msf.example/service-tecnico/reparaciones/${ID}`)
    expect(urlEtiquetaReparacion('http://localhost:4300', ID)).toBe(`http://localhost:4300/service-tecnico/reparaciones/${ID}`)
    expect(urlEtiquetaReparacion('https://panel.msf.example/', ID)).toBe(`https://panel.msf.example/service-tecnico/reparaciones/${ID}`) // sin la barra final
    expect(urlEtiquetaReparacion('http://mundojc.localhost:4300', ID)).toBe(`http://mundojc.localhost:4300/service-tecnico/reparaciones/${ID}`)
    expect(urlEtiquetaReparacion('http://[::1]:4300', ID)).toBe(`http://[::1]:4300/service-tecnico/reparaciones/${ID}`)
    expect(urlEtiquetaReparacion('https://[2001:db8::1]/', ID)).toBe(`https://[2001:db8::1]/service-tecnico/reparaciones/${ID}`)
    expect(urlEtiquetaReparacion('HTTPS://Panel.Example', ID.toUpperCase())).toBe(`HTTPS://Panel.Example/service-tecnico/reparaciones/${ID.toUpperCase()}`)
  })

  it.each([
    'https://usuario:clave@panel.example',
    'https://usuario@panel.example',
    'https://panel.example/ruta',
    'https://panel.example//',
    'https://panel.example?x=1',
    'https://panel.example/?x=1',
    'https://panel.example#fragmento',
    'https://panel.example:99999999',
    'http://[::1',
    'http://::1',
    'http://[::1]x',
    'http://[zz::1]',
    'http://[]',
    'http://[::1]/ruta',
    'http://usuario@[::1]',
    'ftp://panel.example',
    ['java', 'script:alert(1)'].join(''),
    '//panel.example',
    'panel.example',
    'https://',
    'https://pan el.example',
    'https://panel.example\\evil.example',
    'https://panel.example\n',
    'https://panél.example',
    '',
  ])('rechaza el origen %j', (origen) => {
    expect(() => urlEtiquetaReparacion(origen, ID)).toThrow()
  })

  it.each(['r-1', '', ID + '/x', ID + '?a=1', `../${ID}`, ID.slice(1), ID.replace(/-/g, ''), `${ID}\n`, 'g'.repeat(36)])('rechaza el id %j', (id) => {
    expect(() => urlEtiquetaReparacion('https://panel.example', id)).toThrow()
  })

  it('no lleva datos personales ni el enlace público de seguimiento', () => {
    const url = urlEtiquetaReparacion('https://panel.example', ID)
    expect(url).not.toContain('/seguimiento/')
    expect(url).not.toContain('to=')
    expect(url).not.toContain('?')
    expect(url).not.toContain('#')
    expect(url.split('/service-tecnico/reparaciones/')[1]).toBe(ID)
  })

  it('una dirección que no entra en la versión 10 hace fallar al generador, no se trunca', () => {
    const origen = `https://${'a'.repeat(140)}.example.com`
    const url = urlEtiquetaReparacion(origen, ID)
    expect(new TextEncoder().encode(url).length).toBeGreaterThan(213)
    expect(() => generarQr(url)).toThrow(QrDemasiadoLargo)
  })
})

describe('entorno de prueba (FR-049)', () => {
  it.each([['localhost', true], ['127.0.0.1', true], ['mundojc.localhost', true], ['sanjavucho.localhost', true], ['[::1]', true], ['::1', true], ['LOCALHOST', true], ['panel.example', false], ['localhost.example.com', false], ['[2001:db8::1]', false], ['notlocalhost', false]])('%s → %s', (host, esperado) => {
    expect(esEntornoDePrueba(host)).toBe(esperado)
  })
})

describe('tamaños y medidas (FR-045)', () => {
  it('ofrece los tres tamaños y el personalizado con sus nombres exactos', () => {
    expect(TAMANOS_ETIQUETA.map((t) => t.nombre)).toEqual(['Chica · 40 × 25 mm', 'Mediana · 50 × 30 mm', 'Grande · 70 × 40 mm', 'Personalizada'])
    expect(medidasDeTamano('chica', { ancho: 60, alto: 20 })).toEqual({ ancho: 40, alto: 25 })
    expect(medidasDeTamano('mediana', { ancho: 60, alto: 20 })).toEqual({ ancho: 50, alto: 30 })
    expect(medidasDeTamano('grande', { ancho: 60, alto: 20 })).toEqual({ ancho: 70, alto: 40 })
    expect(medidasDeTamano('personalizada', { ancho: 60, alto: 20 })).toEqual({ ancho: 60, alto: 20 })
  })

  it('valida ancho 25–100, alto 15–100 y copias 1–10, solo enteros', () => {
    expect([24, 25, 100, 101, 25.5, NaN].map(anchoValido)).toEqual([false, true, true, false, false, false])
    expect([14, 15, 100, 101, 15.5, NaN].map(altoValido)).toEqual([false, true, true, false, false, false])
    expect([0, 1, 10, 11, 2.5, NaN].map(copiasValidas)).toEqual([false, true, true, false, false, false])
  })
})

describe('preferencia en localStorage (FR-045, amenaza 3.8)', () => {
  const almacen = (valor: string | null) => ({ getItem: () => valor })
  afterEach(() => vi.restoreAllMocks())

  it('sin dato, con almacén ausente o bloqueado cae al predeterminado (mediana)', () => {
    expect(leerPreferencia(almacen(null))).toEqual(PREFERENCIA_PREDETERMINADA)
    expect(leerPreferencia(null)).toEqual(PREFERENCIA_PREDETERMINADA)
    expect(leerPreferencia({ getItem: () => { throw new DOMException('bloqueado', 'SecurityError') } })).toEqual(PREFERENCIA_PREDETERMINADA)
    expect(PREFERENCIA_PREDETERMINADA.tamano).toBe('mediana')
  })

  it.each(['{', 'no es json', '[]', 'null', '42', '{"tamano":"enorme","ancho":50,"alto":30}', '{"tamano":"grande","ancho":"50","alto":30}', '{"tamano":"grande"}', '{"tamano":"grande","ancho":null,"alto":30}'])(
    'un dato corrupto o inválido (%s) cae al predeterminado',
    (crudo) => expect(leerPreferencia(almacen(crudo))).toEqual(PREFERENCIA_PREDETERMINADA),
  )

  it('lee una preferencia válida y recorta las medidas extremas a los rangos', () => {
    expect(leerPreferencia(almacen('{"tamano":"grande","ancho":60,"alto":20}'))).toEqual({ tamano: 'grande', ancho: 60, alto: 20 })
    expect(leerPreferencia(almacen('{"tamano":"personalizada","ancho":99999,"alto":-5}'))).toEqual({ tamano: 'personalizada', ancho: 100, alto: 15 })
    expect(leerPreferencia(almacen('{"tamano":"personalizada","ancho":1,"alto":1e9}'))).toEqual({ tamano: 'personalizada', ancho: 25, alto: 100 })
    expect(leerPreferencia(almacen('{"tamano":"personalizada","ancho":40.6,"alto":20.2}'))).toEqual({ tamano: 'personalizada', ancho: 41, alto: 20 })
  })

  it('guarda solo tamaño y medidas (nunca la cantidad) y un fallo del almacén no lanza', () => {
    const setItem = vi.fn()
    guardarPreferencia({ tamano: 'chica', ancho: 60, alto: 20 }, { setItem })
    expect(setItem).toHaveBeenCalledWith(CLAVE_PREFERENCIA, '{"tamano":"chica","ancho":60,"alto":20}')
    expect(CLAVE_PREFERENCIA).toBe('msf.service.etiqueta')
    expect(() => guardarPreferencia(PREFERENCIA_PREDETERMINADA, { setItem: () => { throw new DOMException('lleno', 'QuotaExceededError') } })).not.toThrow()
    expect(() => guardarPreferencia(PREFERENCIA_PREDETERMINADA, null)).not.toThrow()
  })
})

describe('módulo mínimo de 0,4 mm (FR-047)', () => {
  it('elige la disposición horizontal desde 1,25 veces el alto', () => {
    expect(disposicionDe(50, 30)).toBe('horizontal')
    expect(disposicionDe(50, 40)).toBe('horizontal') // 50 = 1,25 × 40
    expect(disposicionDe(49, 40)).toBe('vertical')
    expect(disposicionDe(40, 40)).toBe('vertical')
  })

  it('el QR nunca ocupa más del 60 % de la dimensión que comparte con el texto', () => {
    expect(FRACCION_MAXIMA_QR).toBe(0.6)
    // Horizontal 100 × 80: el alto dejaría 77 mm, pero manda el 60 % del ancho libre (97 mm).
    expect(ladoDelQrMm(100, 80)).toBeCloseTo(97 * 0.6, 10)
    // Vertical 40 × 40: el ancho dejaría 37 mm, pero manda el 60 % del alto libre.
    expect(ladoDelQrMm(40, 40)).toBeCloseTo(37 * 0.6, 10)
    // Con poco ancho o poco alto manda el margen, no la fracción.
    expect(ladoDelQrMm(50, 30)).toBe(27)
  })

  it('el QR ocupa el mayor cuadrado que entra con 1,5 mm de margen', () => {
    expect(MARGEN_MM).toBe(1.5)
    expect(ladoDelQrMm(50, 30)).toBe(27) // horizontal: manda el alto (30 − 3)
    expect(ladoDelQrMm(40, 25)).toBe(22)
    expect(ladoDelQrMm(25, 100)).toBe(22) // vertical: manda el ancho (25 − 3)
  })

  it('el umbral es exacto: 0,4 mm por módulo se permite y menos no', () => {
    // 45 módulos de símbolo (versión 7) + 8 de zona quieta = 53; 53 × 0,4 = 21,2 mm de lado.
    expect(mmPorModulo(40, 24.2, 45)).toBeCloseTo(0.4, 10)
    expect(etiquetaDemasiadoChica(40, 24.2, 45)).toBe(false)
    expect(etiquetaDemasiadoChica(40, 24.1, 45)).toBe(true)
  })

  it('con una URL típica de panel entran las tres medidas predefinidas y la mínima personalizada no', () => {
    const tamano = generarQr(urlEtiquetaReparacion('https://panel.msf.example', ID)).tamano
    for (const t of TAMANOS_ETIQUETA.filter((x) => x.clave !== 'personalizada')) expect(etiquetaDemasiadoChica(t.ancho, t.alto, tamano), t.nombre).toBe(false)
    expect(etiquetaDemasiadoChica(25, 15, tamano)).toBe(true)
  })

  it('la distribución deja lugar al texto en las medidas extremas', () => {
    for (const [ancho, alto] of [[25, 15], [100, 15], [25, 100], [100, 100], [40, 25], [50, 30], [70, 40]]) {
      const d = distribucionDeEtiqueta(ancho, alto, 6)
      expect(d.lado).toBeGreaterThan(0)
      expect(d.fuenteTexto).toBeGreaterThan(0)
      expect(d.fuenteCodigo).toBeGreaterThanOrEqual(d.fuenteTexto)
      const usado = d.disposicion === 'horizontal' ? d.lado + 2 * d.margen : ancho
      expect(usado).toBeLessThanOrEqual(ancho + 1e-9)
    }
  })
})

describe('textosDeEtiqueta (FR-044)', () => {
  it('devuelve solo código, tienda, equipo e ingreso', () => {
    const reparacion = {
      codigo: 'R-0238', equipo: 'PlayStation', modelo: '5', ingreso_en: '2026-11-12',
      cliente: 'Ana Pérez', contacto: '11 5555-5555', falla: 'No enciende', numero_serie: 'SN-1', accesorios: 'Cargador',
      tecnico_id: 't-1', total_cliente: 123456,
    }
    const textos = textosDeEtiqueta(reparacion, { nombre: 'San Javucho' })
    expect(textos).toEqual({ codigo: 'R-0238', tienda: 'San Javucho', equipo: 'PlayStation 5', ingreso: 'Ingreso 12/11/2026' })
    expect(JSON.stringify(textos)).not.toMatch(/Ana|5555|enciende|SN-1|Cargador|t-1|123456/)
  })
})
