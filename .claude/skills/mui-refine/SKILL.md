---
name: mui-refine
description: Diseña, revisa o modifica componentes Material UI dentro de Refine en esta plataforma. Úsala para theme, componentes MUI, layouts, formularios, tablas o responsividad de `apps/web`; no para migrar a otro framework UI.
---

# Material UI con Refine

El stack actual es Vite + React 18, `@mui/material` 6, Emotion y `@refinedev/mui` 8. Mantén esa combinación: no introduzcas Tailwind, shadcn, MUI X o una migración de MUI como efecto secundario de una pantalla.

- Revisa el theme único de `apps/web/src/App.tsx` antes de añadir colores, tipografías o espaciados. Usa `ThemeProvider` y `CssBaseline` existentes; no crees themes locales ni valores visuales inconsistentes.
- Prefiere componentes semánticos de MUI y sus APIs públicas. Para una pantalla de recurso, conserva los contenedores de Refine (`List`, `Create`, `Edit`, `ThemedLayout`) y combina MUI solo donde aporta la interfaz.
- Los formularios deben tener `label`, mensajes de error visibles, estado de envío y foco recuperable; los controles y tablas deben funcionar con teclado. Para un requisito o auditoría WCAG, carga la skill de accesibilidad correspondiente.
- Diseña de forma responsive con `Stack`, `Box`, `Grid` y breakpoints del theme, sin asumir viewport fijo. Evita CSS global o selectores que rompan componentes de Refine.
- No escondas errores, permisos ni estados de carga detrás de estilos. La autorización sigue en Supabase/RLS y el control de acceso de Refine; MUI no reemplaza esos contratos.
- Valida cambios de interfaz con `pnpm lint`, `pnpm --filter @platform/web test` y `pnpm build`. Complementa con `frontend-design` o `web-design-guidelines` solo si el pedido exige diseño o revisión UX.
