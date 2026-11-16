import { describe, expect, it } from 'vitest'
import { urlHttpSegura } from './urlHttpSegura'

// El esquema se arma en dos partes para no tener el literal «javascript:» (regla no-script-url de oxlint).
const JS = 'java' + 'script:'

describe('urlHttpSegura', () => {
  it('deja pasar http y https', () => {
    expect(urlHttpSegura('https://tienda.ejemplo.com/privacidad')).toBe('https://tienda.ejemplo.com/privacidad')
    expect(urlHttpSegura('http://tienda.ejemplo.com/p')).toBe('http://tienda.ejemplo.com/p')
    expect(urlHttpSegura('  https://x.ejemplo.com  ')).toBe('https://x.ejemplo.com')
  })
  it('deja pasar una ruta relativa (mismo origen)', () => {
    expect(urlHttpSegura('/privacidad')).toBe('/privacidad')
  })
  it.each([`${JS}alert(1)`, `JaVa${'ScRiPt:'}alert(1)`, ` ${JS}alert(1)`, 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://x.com', 'blob:https://x.com/1'])(
    'rechaza %s', (url) => { expect(urlHttpSegura(url)).toBeNull() },
  )
  it('rechaza una URL sin esquema explícito: //host, /\\host, ejemplo.com/x y rutas relativas sin barra', () => {
    expect(urlHttpSegura('https://evil.example.com@good.example.com/')).toBeNull()
    expect(urlHttpSegura('http://usuario:clave@tienda.ejemplo.com/')).toBeNull()
    expect(urlHttpSegura('//evil.example.com/x')).toBeNull()
    expect(urlHttpSegura('/\\evil.example.com')).toBeNull()
    expect(urlHttpSegura('ejemplo.com/privacidad')).toBeNull()
    expect(urlHttpSegura('privacidad')).toBeNull()
    expect(urlHttpSegura('  //evil.example.com')).toBeNull()
  })
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
