import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { i18nProvider } from './providers/i18nProvider'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

describe('documento base y título por defecto', () => {
  it('declara el idioma español, un título propio y una descripción', () => {
    expect(html).toContain('<html lang="es">')
    expect(html).toMatch(/<title>Gestión comercial<\/title>/)
    expect(html).toMatch(/<meta name="description" content="[^"]{20,}"/)
  })
  it('no muestra el nombre de la plantilla en la app', () => {
    expect(html).not.toMatch(/Automation Platform Template/i)
    expect(i18nProvider.translate('documentTitle.default')).toBe('Gestión comercial')
    expect(i18nProvider.translate('documentTitle.suffix')).not.toMatch(/Template/i)
  })
})
