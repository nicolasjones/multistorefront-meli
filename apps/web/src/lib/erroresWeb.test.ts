import { describe, expect, it, vi } from 'vitest'
import { crearEvento, crearRegistroErrores, filtrarEvento, fijarOrganizacionErrores, leerDsn, limpiarTexto, type EventoError } from './erroresWeb'

const DSN = 'https://clave123@errores.test/7'
const ORG = '123e4567-e89b-42d3-a456-426614174000'

const evento = (valor: string, extra: Partial<EventoError> = {}): EventoError => ({
  event_id: 'abc', timestamp: '2026-11-17T00:00:00Z', platform: 'javascript', level: 'error', environment: 'test', release: '1',
  exception: { values: [{ type: 'Error', value: valor }] }, ...extra,
})

describe('limpiarTexto', () => {
  it('oculta correos, teléfonos, bearer y JWT', () => {
    expect(limpiarTexto('falló para ana@mail.com')).toBe('falló para [correo]')
    expect(limpiarTexto('llamar al +54 11 5555-1234')).toBe('llamar al [numero]')
    expect(limpiarTexto('Authorization: Bearer abc.def')).toContain('[token]')
    expect(limpiarTexto('jwt eyJabcde.eyJabcde.firma')).toBe('jwt [token]')
  })

  it('filtra parámetros sensibles de la URL conservando el nombre', () => {
    expect(limpiarTexto('GET /x?access_token=secreto&a=1')).toBe('GET /x?access_token=[filtrado]&a=1')
  })

  it('no toca texto inocuo', () => {
    expect(limpiarTexto('No se pudo cargar el listado')).toBe('No se pudo cargar el listado')
  })
})

describe('filtrarEvento', () => {
  it('sin excepciones no hay nada que enviar', () => {
    expect(filtrarEvento(evento('x', { exception: { values: [] } }))).toBeNull()
  })

  it('reduce la URL a origen y ruta, limpia el mensaje y agrupa por tipo y mensaje', () => {
    const filtrado = filtrarEvento(evento('error con a@b.com', { request: { url: 'https://app.test/ruta?token=zzz#x' } }))
    expect(filtrado?.request?.url).toBe('https://app.test/ruta')
    expect(filtrado?.exception.values[0].value).toBe('error con [correo]')
    expect(filtrado?.fingerprint).toEqual(['Error', 'error con [correo]'])
  })

  it('conserva la organización solo si es un UUID', () => {
    expect(filtrarEvento(evento('x', { tags: { organizacion_id: ORG } }))?.tags).toEqual({ organizacion_id: ORG })
    expect(filtrarEvento(evento('x', { tags: { organizacion_id: 'Mi Empresa SA' } }))?.tags).toBeUndefined()
  })
})

describe('leerDsn', () => {
  it('arma la URL de store con la clave pública', () => {
    expect(leerDsn(DSN)).toEqual({ url: 'https://errores.test/api/7/store/?sentry_version=7&sentry_key=clave123', clave: 'clave123' })
  })

  it('rechaza DSN ausentes, sin clave, sin proyecto numérico o mal formados', () => {
    expect(leerDsn(undefined)).toBeNull()
    expect(leerDsn('https://errores.test/7')).toBeNull()
    expect(leerDsn('https://k@errores.test/proyecto')).toBeNull()
    expect(leerDsn('no es url')).toBeNull()
  })
})

describe('crearEvento', () => {
  it('toma tipo y mensaje del Error, o un texto para valores no Error', () => {
    expect(crearEvento(new TypeError('malo'), { ambiente: 'a', version: 'v' }).exception.values[0]).toEqual({ type: 'TypeError', value: 'malo' })
    expect(crearEvento('texto', { ambiente: 'a', version: 'v' }).exception.values[0].value).toBe('texto')
    expect(crearEvento(42, { ambiente: 'a', version: 'v' }).exception.values[0].value).toBe('Error desconocido')
  })

  it('incluye la organización fijada y la deja de incluir al limpiarla', () => {
    fijarOrganizacionErrores(ORG)
    expect(crearEvento(new Error('x'), { ambiente: 'a', version: 'v' }).tags).toEqual({ organizacion_id: ORG })
    fijarOrganizacionErrores('basura')
    expect(crearEvento(new Error('x'), { ambiente: 'a', version: 'v' }).tags).toBeUndefined()
  })
})

describe('crearRegistroErrores', () => {
  it('sin DSN es un no-op inactivo', () => {
    const enviar = vi.fn()
    const registro = crearRegistroErrores({ enviar })
    registro.capturar(new Error('x'))
    expect(registro.activo).toBe(false)
    expect(enviar).not.toHaveBeenCalled()
  })

  it('envía el evento filtrado a la URL del DSN', () => {
    const enviar = vi.fn().mockResolvedValue(undefined)
    const registro = crearRegistroErrores({ dsn: DSN, ambiente: 'stg', version: '9', enviar })
    registro.capturar(new Error('fallo de ana@mail.com'))
    expect(enviar).toHaveBeenCalledTimes(1)
    const [url, cuerpo] = enviar.mock.calls[0]
    expect(url).toContain('/api/7/store/')
    expect(cuerpo).toContain('[correo]')
    expect(cuerpo).not.toContain('ana@mail.com')
    expect(JSON.parse(cuerpo)).toMatchObject({ environment: 'stg', release: '9' })
  })

  it('no repite el mismo error dentro del minuto pero sí después', () => {
    let t = 0
    const enviar = vi.fn().mockResolvedValue(undefined)
    const registro = crearRegistroErrores({ dsn: DSN, enviar, ahora: () => t })
    registro.capturar(new Error('igual'))
    t = 30_000
    registro.capturar(new Error('igual'))
    expect(enviar).toHaveBeenCalledTimes(1)
    t = 61_000
    registro.capturar(new Error('igual'))
    expect(enviar).toHaveBeenCalledTimes(2)
  })

  it('limita a 10 envíos por minuto aunque los errores sean distintos', () => {
    const enviar = vi.fn().mockResolvedValue(undefined)
    const registro = crearRegistroErrores({ dsn: DSN, enviar, ahora: () => 0 })
    for (let i = 0; i < 15; i += 1) registro.capturar(new Error(`distinto-${i}`))
    expect(enviar).toHaveBeenCalledTimes(10)
  })

  it('un fallo del envío no rompe la aplicación', () => {
    const registro = crearRegistroErrores({ dsn: DSN, enviar: () => { throw new Error('red') } })
    expect(() => registro.capturar(new Error('x'))).not.toThrow()
    const asincrono = crearRegistroErrores({ dsn: DSN, enviar: () => Promise.reject(new Error('red')) })
    expect(() => asincrono.capturar(new Error('y'))).not.toThrow()
  })
})
