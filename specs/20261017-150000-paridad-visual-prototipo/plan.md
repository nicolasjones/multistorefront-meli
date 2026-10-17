# Implementation Plan: Plataforma · Paridad visual con el prototipo

**Branch**: `epic/MSF-XXX-paridad-visual-prototipo` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/20261017-150000-paridad-visual-prototipo/spec.md`

## Summary

Llevar el lenguaje visual del panel a la fidelidad del prototipo `design/pantallas/*.dc.html`, cubriendo
tres capas: (1) tokens (colores de etiquetas/alertas/filas/sider, escala tipográfica, formas y
dimensiones) en `apps/web/src/tema/`; (2) componentes base reutilizables (casilla, switch, segmentado,
alerta, snackbar, menú, tabs, barra, avatar, miniatura, contenedor de tabla) en `components/base/` y el
tema; (3) shell del panel (`SiderPanel`, `EncabezadoPanel`, `SelectorEmpresa`, `MenuCuenta`) en
`components/navegacion/`. Se verifica con los inventarios generados y no cambia lógica, rutas ni permisos.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`

**Primary Dependencies**: MUI (`@mui/material`), `@refinedev/mui` — ya presentes; sin dependencias nuevas

**Storage**: N/A (sin migraciones)

**Testing**: Vitest + Testing Library (`pnpm test`); `pnpm lint`, `pnpm build`, `pnpm docs:check`

**Delivery scope**: `refine`

**Constraints**: no copiar HTML/CSS del prototipo; sin valores sueltos en pantallas; sin cambios de
comportamiento, rutas ni permisos; responsive 320/768/1440 con la tabla→tarjetas existente en xs;
contraste AA

## Constitution Check

Solo frontend: sin tablas, RLS ni service-role. Cambio de plataforma/tooling propio → exige documentación
en `docs/` (se cubre actualizando `docs/sistema-de-diseno.md`, T028). Principio VI (panel operable): no se
agregan ni mueven pantallas ni rutas; se conservan carga/vacío/error/éxito, teclado y lector, y anchos
320/768/1440. Sin violaciones ni Complexity Tracking.

## Project Structure

```text
apps/web/src/tema/tokens.ts            # tokens nuevos (colores, formas, dimensiones)
apps/web/src/tema/temaPanel.ts         # styleOverrides nuevos (Checkbox, Switch, Menu, Tabs, ...)
apps/web/src/components/base/          # componentes base nuevos/alineados + tests
apps/web/src/components/pagina/        # contenedor de tabla / ContenidoAdaptable (card, filas)
apps/web/src/components/navegacion/    # SiderPanel, EncabezadoPanel, SelectorEmpresa, MenuCuenta
design/pantallas/*.inventory.json      # inventarios generados (Clientes, Productos, AdminSider, AdminHeader)
docs/sistema-de-diseno.md              # catálogo actualizado
specs/20261017-150000-paridad-visual-prototipo/{spec,plan,tasks}.md
```

**Structure Decision**: los valores viven en `tema/tokens.ts`; los componentes base reutilizables en
`components/base/`; el shell en `components/navegacion/`. Las pantallas no se tocan salvo para consumir
los componentes base alineados.

## Fases

1. **US1 — Tokens (P1)**: colores (etiquetas, alertas, filas, sider), escala tipográfica, formas.
2. **US2 — Componentes base (P1)**: casilla, switch, segmentado, alerta, snackbar, menú, tabs, barra,
   avatar, miniatura, contenedor de tabla; `EtiquetaEstado`.
3. **US3 — Shell (P1)**: `SiderPanel`, `EncabezadoPanel`, `SelectorEmpresa`, `MenuCuenta`.
4. **US4 — Verificación (P2)**: recorrer los inventarios de Clientes y Productos y mapear 1:1.

`/speckit-implement` se invoca fase por fase (o historia por historia).

## Riesgos

- **Contraste**: los tonos pastel del prototipo pueden no dar AA; se ajusta el texto y se anota el desvío.
- **Responsive**: el prototipo es 1440 fijo; "idéntico" solo aplica en desktop. En xs rige la decisión
  de tabla→tarjetas.
- **Doble uso de `ToggleButton`**: hoy se usa para el filtro-píldora (`.chip.btn`, radio 999) y el
  prototipo distingue el segmentado `.seg` (radio 9). Hay que separarlos sin romper el test vigente.
- **Radio de `EtiquetaEstado`**: pasa de 6 a 999; revisar consumidores y tests.
- **Base de la rama**: `main` tiene el inventario y los prototipos, pero la versión fiel de las pantallas
  de Clientes/Productos hoy vive en `dokploy`; la verificación US4 se hace sobre la rama de trabajo.
- **Alcance**: no arrastrar features sin dueño (correo, importar, etiquetas, ranking, stock, categorías,
  destacado, newsletter); están en la matriz como fuera de alcance.

## Entrega por familias

Para que cada cambio siga siendo revisable y revertible con un `git revert -m 1`, se entrega por
familias (tokens → componentes → shell → verificación), no como un solo PR gigante.
