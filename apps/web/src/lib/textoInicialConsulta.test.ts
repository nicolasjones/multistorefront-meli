import { describe, expect, it } from 'vitest'
import type { ItemConsulta } from './consultas'
import { enlaceRespuesta } from './responderConsulta'
import { armarTextoInicial } from './textoInicialConsulta'

const consulta = { nombre: 'Bruno Gómez', empresa_nombre: 'San Javucho', producto_nombre: null, origen: 'pedido' as const, contacto: 'bruno@example.com' }
const ITEMS: ItemConsulta[] = [
  { orden: 1, producto_id: 'p-1', descripcion: 'Joystick Pro', sku: 'JOY-1', cantidad: 2, precio_referencia: 2500 },
  { orden: 2, producto_id: null, descripcion: 'Cable USB', sku: null, cantidad: 1, precio_referencia: null },
]

describe('texto inicial de «Responder» (F-CON-04) y de un pedido (MSF-176, B1, P-6)', () => {
  it('una consulta común conserva el texto de siempre', () => {
    expect(armarTextoInicial({ nombre: 'Ana', empresa_nombre: 'San Javucho', producto_nombre: 'Funda' }).cuerpo)
      .toBe('Hola Ana, te escribimos de San Javucho por tu consulta por Funda. ')
  })

  it('un pedido lista los ítems y promete confirmar disponibilidad y precio', () => {
    expect(armarTextoInicial(consulta, null, ITEMS).cuerpo).toBe([
      'Hola Bruno Gómez, recibimos tu pedido:',
      '• 2 × Joystick Pro (JOY-1)',
      '• 1 × Cable USB',
      'Te escribimos para confirmar disponibilidad y precio.',
    ].join('\n'))
  })

  it('mientras los ítems no cargaron sale sin la lista', () => {
    expect(armarTextoInicial(consulta, null, null).cuerpo).toBe('Hola Bruno Gómez, recibimos tu pedido:\nTe escribimos para confirmar disponibilidad y precio.')
  })

  it('con una respuesta rápida elegida manda su texto (no cambia el comportamiento de F-CON-06)', () => {
    expect(armarTextoInicial(consulta, { texto: 'Gracias {{nombre}}' }, ITEMS).cuerpo).not.toContain('recibimos tu pedido')
  })

  it('el enlace de correo codifica TODO: ítems con HTML, saltos de línea y un contacto con parámetros', () => {
    const items: ItemConsulta[] = [{ orden: 1, producto_id: null, descripcion: '<script>alert(1)</script> & más=1', sku: 'A B', cantidad: 3, precio_referencia: null }]
    const enlace = enlaceRespuesta({ ...consulta, contacto: 'x@example.com?bcc=otro@example.com' }, null, items)!
    expect(enlace.via).toBe('correo')
    expect(enlace.href.startsWith('mailto:x%40example.com%3Fbcc%3Dotro%40example.com?subject=')).toBe(true)
    // Nada sin codificar: ni el < >, ni el salto de línea, ni el & del texto dentro del cuerpo.
    const cuerpo = enlace.href.split('&body=')[1]
    expect(cuerpo).not.toMatch(/[<>\n &]/)
    expect(decodeURIComponent(cuerpo)).toContain('• 3 × <script>alert(1)</script> & más=1 (A B)')
    expect(enlace.href.split('?').length).toBe(2)
  })

  it('el enlace de WhatsApp (wa.me) lleva el texto codificado', () => {
    const enlace = enlaceRespuesta({ ...consulta, contacto: '+54 9 11 5555-1234' }, null, ITEMS)!
    expect(enlace.via).toBe('WhatsApp')
    expect(enlace.href.startsWith('https://wa.me/')).toBe(true)
    expect(enlace.href).not.toMatch(/[\n ]/)
    expect(decodeURIComponent(enlace.href.split('text=')[1])).toContain('• 2 × Joystick Pro (JOY-1)')
  })
})
