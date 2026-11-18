import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { i18nProvider } from './providers/i18nProvider'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

describe('documento base y título por defecto', () => {
  it('declara el idioma español y un título propio', () => {
    expect(html).toContain('<html lang="es">')
    expect(html).toMatch(/<title>Gestión comercial<\/title>/)
    // La descripción la pone cada pantalla pública (tienda); un meta estático en el documento base chocaría con la suya.
    expect(html).not.toMatch(/<meta name="description"/)
  })
  it('no muestra el nombre de la plantilla en la app', () => {
    expect(html).not.toMatch(/Automation Platform Template/i)
    expect(i18nProvider.translate('documentTitle.default')).toBe('Gestión comercial')
    expect(i18nProvider.translate('documentTitle.suffix')).not.toMatch(/Template/i)
  })
})
