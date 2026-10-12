# Implementation Plan: Plataforma · Sistema de diseño

**Branch**: `epic/MSF-117-plataforma-sistema-de-diseno` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/20261012-130000-sistema-de-diseno/spec.md`

## Summary

Extraer el `createTheme` hoy inline en `apps/web/src/App.tsx` (paleta `#136f63`, Inter) a un módulo de tokens + tema propio que extiende el tema MUI/Refine del template, con los valores observados en el prototipo. Sobre ese tema, alinear los componentes base existentes (`components/estados`, `pagina`, `navegacion`) y documentar un catálogo con reglas de uso. Aplicar el sistema a encabezado, sider y selector de empresa, y proveer un mecanismo de tema por empresa para tiendas públicas. Sin tocar la lógica de negocio.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`

**Primary Dependencies**: MUI (`@mui/material`), `@refinedev/mui` — ya presentes; sin dependencias nuevas salvo, si hace falta, un paquete de fuentes (Sora, Instrument Sans, Barlow, Barlow Condensed) a decidir en T002 respetando licencias (OFL)

**Storage**: N/A (sin migraciones)

**Testing**: Vitest + Testing Library (`pnpm test`); `pnpm lint`, `pnpm build`, `pnpm docs:check`

**Delivery scope**: `refine`

**Constraints**: no copiar HTML/CSS del prototipo; no valores de estilo sueltos en pantallas; no secretos; sin cambios de comportamiento ni permisos

## Constitution Check

Solo frontend: sin tablas, RLS ni service-role. Cambio de plataforma/tooling propio → exige documentación en `docs/` (se cubre con el catálogo, T012). Sin violaciones ni Complexity Tracking.

## Project Structure

```text
apps/web/src/tema/            # tokens, tema del panel, tema de tienda por empresa
apps/web/src/components/base/ # componentes base nuevos (si no existen ya)
apps/web/src/components/{estados,pagina,navegacion}/  # alineados al sistema
apps/web/src/App.tsx          # consume el tema extraído
docs/sistema-de-diseno.md     # catálogo de componentes y reglas de uso
specs/20261012-130000-sistema-de-diseno/{spec,plan,tasks}.md
```

## Fases

1. **US1 — Tokens y tema (P0)**: módulo de tokens, tipografías, tema MUI aplicado en `App.tsx`.
2. **US2 — Componentes base (P0)**: inventario contra el prototipo y lo existente, variantes/estados, catálogo.
3. **US3 — Estructura del panel (P0)**: `EncabezadoPanel`, `SiderPanel`, selector de empresa.
4. **US4 — Temas de tienda (P1)**: contrato de tema por empresa y proveedor aislado del tema del panel.

`/speckit-implement` se invoca fase por fase.

## Riesgos

- Los tokens "observados" pueden variar al confirmarlos: se documenta el valor final y la diferencia en el PR.
- El selector de empresa existe hoy como contexto (`OrganizacionActiva`); se restiliza sin cambiar su lógica.
- DS-04 depende de dónde se persista la identidad (Empresa · Identidad visual, otra épica): se entrega el contrato y el proveedor, no la pantalla.
