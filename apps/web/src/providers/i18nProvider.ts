import type { I18nProvider } from '@refinedev/core'

// Traducciones de las claves fijas que Refine resuelve internamente en
// inglés cuando no hay i18nProvider configurado — el título del documento
// (DocumentTitleHandler) y el formulario de login de AuthPage
// (apps/web/src/pages/login.tsx), único uso de AuthPage en este proyecto.
// No es una app multi-idioma: un solo locale ('es'), sin selector.
const TRADUCCIONES: Record<string, string> = {
  'documentTitle.default': 'Automation Platform Template',
  'documentTitle.suffix': ' | Automation Platform Template',
  'pages.login.title': 'Iniciar sesión',
  'pages.login.fields.email': 'Correo electrónico',
  'pages.login.fields.password': 'Contraseña',
  'pages.login.errors.requiredEmail': 'El correo electrónico es obligatorio',
  'pages.login.errors.requiredPassword': 'La contraseña es obligatoria',
  'pages.login.buttons.rememberMe': 'Recordarme',
  'pages.login.signin': 'Iniciar sesión',
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
