import { describe, expect, it } from 'vitest'
import { ETIQUETA_ESTADO_CAMPANA, ETIQUETA_ESTADO_DESTINATARIO, textoFechaCampana, textoProgreso } from './correoMasivoHistorial'

describe('textoFechaCampana', () => {
  it('muestra la fecha en hora de Buenos Aires sin coma', () => {
    expect(textoFechaCampana('2026-10-30T17:05:00Z')).toBe('30/10/2026 14:05')
  })

  it('una fecha ilegible queda vacía en vez de «Invalid Date»', () => {
    expect(textoFechaCampana('no es fecha')).toBe('')
    expect(textoFechaCampana('')).toBe('')
  })

  it('cruza el día según la zona horaria (02:30 UTC es el día anterior en Buenos Aires)', () => {
    expect(textoFechaCampana('2026-11-01T02:30:00Z')).toBe('31/10/2026 23:30')
  })
})

describe('textoProgreso', () => {
  it('cuenta como procesados los destinatarios que ya no están pendientes', () => {
    expect(textoProgreso({ destinatarios: 10, pendientes: 7 })).toBe('3 de 10 procesados')
    expect(textoProgreso({ destinatarios: 4, pendientes: 0 })).toBe('4 de 4 procesados')
  })
})

describe('etiquetas', () => {
  it('cubren todos los estados', () => {
    expect(Object.keys(ETIQUETA_ESTADO_CAMPANA)).toEqual(['en_curso', 'completada'])
    expect(Object.values(ETIQUETA_ESTADO_DESTINATARIO)).toEqual(['Pendiente', 'Enviado', 'Fallido', 'Omitido'])
  })
})
