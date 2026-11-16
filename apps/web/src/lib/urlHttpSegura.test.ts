import { describe, expect, it } from 'vitest'
import { urlHttpSegura } from './urlHttpSegura'

describe('urlHttpSegura', () => {
  it('deja pasar http y https', () => {
    expect(urlHttpSegura('https://tienda.ejemplo.com/privacidad')).toBe('https://tienda.ejemplo.com/privacidad')
    expect(urlHttpSegura('http://tienda.ejemplo.com/p')).toBe('http://tienda.ejemplo.com/p')
    expect(urlHttpSegura('  https://x.ejemplo.com  ')).toBe('https://x.ejemplo.com')
  })
  it('deja pasar una ruta relativa (mismo origen)', () => {
    expect(urlHttpSegura('/privacidad')).toBe('/privacidad')
  })
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://x.com', 'blob:https://x.com/1'])(
    'rechaza %s', (url) => { expect(urlHttpSegura(url)).toBeNull() },
  )
  it('rechaza caracteres de control que algunos navegadores ignoran dentro del esquema', () => {
    expect(urlHttpSegura('java\tscript:alert(1)')).toBeNull()
    expect(urlHttpSegura('java\nscript:alert(1)')).toBeNull()
  })
  it('rechaza vacío, nulo e indefinido', () => {
    expect(urlHttpSegura('')).toBeNull()
    expect(urlHttpSegura('   ')).toBeNull()
    expect(urlHttpSegura(null)).toBeNull()
    expect(urlHttpSegura(undefined)).toBeNull()
  })
})
