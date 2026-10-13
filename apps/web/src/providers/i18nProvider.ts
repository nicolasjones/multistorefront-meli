import type { I18nProvider } from '@refinedev/core'

// Traducciones de las claves fijas que Refine resuelve internamente en
// inglés cuando no hay i18nProvider configurado — el título del documento
// (DocumentTitleHandler). La pantalla de ingreso (pages/login.tsx) escribe sus
// textos fijos y no pasa por aquí.
// No es una app multi-idioma: un solo locale ('es'), sin selector.
const TRADUCCIONES: Record<string, string> = {
  'documentTitle.default': 'Automation Platform Template',
  'documentTitle.suffix': ' | Automation Platform Template',
  // CreateButton/EditButton (@refinedev/mui) — únicos botones default de
  // Refine que este proyecto usa sin envoltorio propio (organizaciones,
  // servidores, clientes, conexiones, miembros).
  'buttons.create': 'Crear',
  'buttons.edit': 'Editar',
}

export const i18nProvider: I18nProvider = {
  translate: (key, options, defaultMessage) => {
    if (key in TRADUCCIONES) return TRADUCCIONES[key]
    if (typeof defaultMessage === 'string') return defaultMessage
    if (typeof options === 'string') return options
    return key
  },
  changeLocale: () => Promise.resolve(),
  getLocale: () => 'es',
}
