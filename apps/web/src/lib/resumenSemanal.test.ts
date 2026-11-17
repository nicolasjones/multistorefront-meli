import { describe, expect, it } from 'vitest'
import { textoProximoEnvio, textoUltimoResumen, type EstadoResumen } from './resumenSemanal'

const estado = (cambios: Partial<EstadoResumen>): EstadoResumen => ({
  activo: true,
  proximo_envio: '2026-11-17T12:00:00Z',
  ultima_semana_desde: null,
  ultimo_estado: null,
  destinatarios: 1,
  ...cambios,
})

describe('texto del próximo envío', () => {
  it('muestra el día y la hora de Buenos Aires, no la de UTC', () => {
    const texto = textoProximoEnvio('2026-11-17T12:00:00Z')
    expect(texto).toContain('17')
    expect(texto).toContain('noviembre')
    expect(texto).toContain('09:00')
  })

  it('una hora de madrugada en UTC cae el día anterior en Buenos Aires', () => {
    const texto = textoProximoEnvio('2026-11-17T01:30:00Z')
    expect(texto).toContain('16')
    expect(texto).toContain('22:30')
  })

  it('una fecha inválida no muestra texto', () => {
    expect(textoProximoEnvio('no es fecha')).toBe('')
    expect(textoProximoEnvio('')).toBe('')
  })
})

describe('texto del último resumen', () => {
  it('sin envíos previos lo dice', () => {
    expect(textoUltimoResumen(estado({}))).toBe('Todavía no se envió ningún resumen.')
    expect(textoUltimoResumen(estado({ ultima_semana_desde: '2026-11-09' }))).toBe('Todavía no se envió ningún resumen.')
    expect(textoUltimoResumen(estado({ ultimo_estado: 'enviado' }))).toBe('Todavía no se envió ningún resumen.')
  })

  it('nombra la semana sin correrse un día por la zona horaria', () => {
    const texto = textoUltimoResumen(estado({ ultima_semana_desde: '2026-11-09', ultimo_estado: 'enviado' }))
    expect(texto).toContain('semana del 9 de noviembre')
    expect(texto).toContain('se envió')
  })

  it('traduce cada estado conocido', () => {
    const casos: Array<[string, string]> = [
      ['fallido', 'no se pudo enviar'],
      ['pendiente', 'se está enviando'],
      ['sin_destinatario', 'no había administradores con correo'],
      ['pausado', 'estaba pausado'],
      ['vencido', 'se descartó'],
    ]
    for (const [codigo, fragmento] of casos) {
      expect(textoUltimoResumen(estado({ ultima_semana_desde: '2026-01-05', ultimo_estado: codigo })), codigo).toContain(fragmento)
    }
  })

  it('un estado desconocido se muestra tal cual', () => {
    expect(textoUltimoResumen(estado({ ultima_semana_desde: '2026-01-05', ultimo_estado: 'raro' }))).toContain('raro.')
  })
})
