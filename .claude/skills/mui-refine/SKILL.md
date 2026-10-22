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

## En esta plataforma: el prototipo manda la UI

El diseño *nuevo* es la excepción: acá la fuente de verdad visual es `design/pantallas/*.dc.html`. Al construir o rehacer una pantalla, el prototipo gana sobre cualquier dirección estética propia: corré `pnpm prototipo:inventario`, implementá con los tokens/tema (`apps/web/src/tema`) y no con valores sueltos, y mapeá lo visible a `## Matriz pantalla↔criterios` en el `spec.md`. El CI lo exige con `pnpm prototipo:check` (inventario al día) y `pnpm matriz:check` (spec con UI sin matriz = inválida). Para la comparación lado a lado: `pnpm --filter @platform/web pantallas:capturar`. Ver `docs/prototipos.md`.
