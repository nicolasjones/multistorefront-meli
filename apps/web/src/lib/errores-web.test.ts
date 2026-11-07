// MSF-369 · F-OPS-03 (FR-021, FR-023, SC-006): filtrado de datos personales, ambiente y versión, y no-op sin DSN.
import { describe, expect, it, vi } from 'vitest'
import { crearEvento, crearRegistroErrores, filtrarEvento, iniciarErrores, leerDsn } from './erroresWeb'

const DSN = 'https://abc123@errores.example.com/7'

describe('erroresWeb', () => {
  it('leerDsn arma la URL de envío y rechaza DSN inválidos o vacíos', () => {
    expect(leerDsn(DSN)?.url).toBe('https://errores.example.com/api/7/store/?sentry_version=7&sentry_key=abc123')
    expect(leerDsn('')).toBeNull()
    expect(leerDsn(undefined)).toBeNull()
    expect(leerDsn('no-es-una-url')).toBeNull()
  })

  it('filtra correos, teléfonos y tokens del mensaje y de la URL', () => {
    const evento = crearEvento(
      new Error('falló ana@example.com tel +54 11 5555-1234 Bearer abc.def.ghi eyJhbGciOi.eyJzdWIiOi.firma'),
      { ambiente: 'staging', version: '1.2.3' },
      'https://panel.example.com/clientes?token=secreto&email=ana@example.com#access_token=zzz',
    )
    const filtrado = filtrarEvento(evento)!
    const texto = JSON.stringify(filtrado)
    expect(texto).not.toMatch(/ana@example\.com|5555|abc\.def|eyJhbGci|secreto|zzz/)
    expect(filtrado.request?.url).toBe('https://panel.example.com/clientes')
    expect(filtrado.exception.values[0].value).toContain('[correo]')
  })

  it('no conserva cuerpos de formulario, cookies, cabeceras ni usuario aunque el evento los traiga', () => {
    const evento = {
      ...crearEvento(new Error('x'), { ambiente: 'local', version: 'dev' }),
      request: { url: 'https://panel.example.com/a', data: { nombre: 'Ana', clave: '1234' }, cookies: 'sid=1', headers: { authorization: 'x' } },
      user: { email: 'ana@example.com' },
    }
    const texto = JSON.stringify(filtrarEvento(evento as never))
    expect(texto).not.toMatch(/Ana|1234|sid=|authorization|user|ana@example/)
  })

  it('agrega ambiente y versión al evento enviado', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined)
    const registro = crearRegistroErrores({ dsn: DSN, ambiente: 'produccion', version: '9.9.9', enviar })
    registro.capturar(new Error('boom'))
    expect(enviar).toHaveBeenCalledTimes(1)
    const cuerpo = JSON.parse(enviar.mock.calls[0][1])
    expect(cuerpo.environment).toBe('produccion')
    expect(cuerpo.release).toBe('9.9.9')
    expect(cuerpo.exception.values[0].value).toBe('boom')
  })

  it('sin DSN no envía nada ni instala manejadores', () => {
    const enviar = vi.fn()
    const registro = crearRegistroErrores({ dsn: '', enviar })
    registro.capturar(new Error('boom'))
    expect(registro.activo).toBe(false)
    expect(enviar).not.toHaveBeenCalled()
    const destino = { addEventListener: vi.fn() } as unknown as Window
    iniciarErrores({ dsn: '' }, destino)
    expect(destino.addEventListener).not.toHaveBeenCalled()
  })

  it('con DSN instala los manejadores de errores y promesas rechazadas', () => {
    const destino = { addEventListener: vi.fn() } as unknown as Window
    iniciarErrores({ dsn: DSN, enviar: vi.fn() }, destino)
    const eventos = (destino.addEventListener as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(eventos).toEqual(['error', 'unhandledrejection'])
  })

  it('un fallo del envío no rompe la aplicación', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('red caída'))
    const registro = crearRegistroErrores({ dsn: DSN, enviar })
    expect(() => registro.capturar(new Error('boom'))).not.toThrow()
    await Promise.resolve()
  })

  it('no reenvía el mismo error dentro de un minuto y limita el volumen por sesión', () => {
    let t = 0
    const enviar = vi.fn().mockResolvedValue(undefined)
    const registro = crearRegistroErrores({ dsn: DSN, enviar, ahora: () => t })
    for (let i = 0; i < 100; i++) registro.capturar(new Error('bucle'))
    expect(enviar).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 50; i++) registro.capturar(new Error(`distinto ${'x'.repeat(i)}`))
    expect(enviar).toHaveBeenCalledTimes(10)
    t = 61_000
    registro.capturar(new Error('bucle'))
    expect(enviar).toHaveBeenCalledTimes(11)
  })
})
