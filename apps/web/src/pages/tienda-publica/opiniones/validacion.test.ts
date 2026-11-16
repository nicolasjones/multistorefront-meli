import { describe, expect, it } from 'vitest'
import { textoOpinionNoPermitido, validarOpinion } from './validacion'

// Espejo de `opiniones_validacion.test.sql`: los mismos casos que el servidor.
const ok = (puntuacion: number | null, comentario: string) => validarOpinion(puntuacion, comentario).ok

describe('validación de opiniones (espejo del servidor)', () => {
  it('largo: 10 y 1.000 caracteres entran; 9 y 1.001 no; el recorte cuenta', () => {
    expect(ok(5, 'Excelente producto, llegó bien')).toBe(true)
    expect(ok(1, 'a'.repeat(10))).toBe(true)
    expect(ok(5, 'a'.repeat(1000))).toBe(true)
    expect(ok(5, 'a'.repeat(9))).toBe(false)
    expect(ok(5, 'a'.repeat(1001))).toBe(false)
    expect(ok(5, `   ${'a'.repeat(9)}   `)).toBe(false)
    expect(validarOpinion(5, `  ${'a'.repeat(10)}  `).comentario).toBe('a'.repeat(10))
  })

  it('el largo se mide en caracteres, no en unidades UTF-16 (emojis)', () => {
    expect(ok(5, '😀'.repeat(10))).toBe(true)
    expect(ok(5, '😀'.repeat(1000))).toBe(true)
    expect(ok(5, '😀'.repeat(1001))).toBe(false)
  })

  it('puntuación: entera de 1 a 5', () => {
    for (const valida of [1, 2, 3, 4, 5]) expect(ok(valida, 'Comentario suficientemente largo')).toBe(true)
    for (const invalida of [0, 6, -1, 2.5, null]) expect(ok(invalida, 'Comentario suficientemente largo')).toBe(false)
  })

  it('lista los campos erróneos', () => {
    expect(validarOpinion(0, 'corto').campos).toEqual(['puntuacion', 'comentario'])
    expect(validarOpinion(3, 'corto').campos).toEqual(['comentario'])
    expect(validarOpinion(9, 'Comentario suficientemente largo').campos).toEqual(['puntuacion'])
  })

  it.each([
    'Mirá http://ejemplo.com ahora mismo',
    'Mirá HTTPS://ejemplo.com ahora',
    'Visitá www.ejemplo para más info',
    'Comprá en ejemplo.com que sale menos',
    'Comprá en ejemplo.com.ar que sale menos',
    'Comprá en tienda.shop que sale menos',
    'Mirá ejemplo.top que sale menos',
    'Todo en ejemplo.com/ofertas hoy',
    'Mirá www . ejemplo y listo ya',
    'Mirá http ://ejemplo ahora mismo',
    'Escribime a t.me/vendedor ahora',
    'Mirá bit.ly/abc123 que sale menos',
    'Comprá en mi-tienda.es, hoy mismo',
    'Comprá en mitienda.es.',
    'Comprá en mitienda3.me, no te lo pierdas',
    'Visitá mitienda.xyzabc/oferta hoy mismo',
    'Comprá en mitienda.ar',
    'Comprá en ejemplo。com hoy mismo',
    'Comprá en ejemplo．com hoy mismo',
    'Comprá en ejemplo｡com hoy mismo',
    'Comprá en ejemplo․com hoy mismo',
    'Comprá en ejemplo﹒com hoy mismo',
    'Dos líneas\nde comentario válido',
    'Texto con tab\tdentro ok',
    'Texto RTL ‮invertido ok',
    'Texto con separador  de línea',
    'Texto con ancho​cero oculto',
  ])('rechaza «%s»', (texto) => {
    expect(ok(5, texto)).toBe(false)
  })

  it.each([
    'Muy bueno. Llegó rápido y funciona.',
    'Me encantó 😀😀 llegó perfecto',
    '<script>alert(1)</script> ok',
    'Excelente producto. Top calidad total',
    'Llegó rápido. Online todo bien, gracias',
    'Buen vendedor. Store ordenada y rápida',
    'Compré en 3 cuotas . com tarjeta y salió bien',
    'Anda bien.No se calienta nada',
    'Muy bueno.me gustó muchísimo',
    'Lo uso a diario.es genial para todo',
    'Me encantó, sí.No sé qué más decir',
    'Excelente producto.Llegó rápido y bien',
    'Pedí el 10. Es ok. Muy bueno todo',
    'Llegó el 3.5 de calificación, genial',
    'Usan http y https para pagar, está bien',
    'Calidad / precio excelente, recomiendo y/o comprar',
    'Compra segura, ejemplo punto com no es enlace',
    'Comprá en ejemplo[.]com hoy mismo',
  ])('acepta «%s»', (texto) => {
    expect(ok(5, texto)).toBe(true)
  })

  it('textoOpinionNoPermitido: frase legítima y enlace', () => {
    expect(textoOpinionNoPermitido('Producto. Top calidad')).toBe(false)
    expect(textoOpinionNoPermitido('visitá ejemplo.com ya')).toBe(true)
  })

  it('con entradas hostiles de 200.000 caracteres responde rápido (sin retroceso exponencial)', () => {
    const inicio = performance.now()
    for (const hostil of ['a'.repeat(200000), 'Bien.No '.repeat(25000), 'mi-tienda.'.repeat(20000), `${' '.repeat(50000)}.com`]) textoOpinionNoPermitido(hostil)
    expect(performance.now() - inicio).toBeLessThan(3000)
  })
})
