# Tasks: Paridad de pantallas con el prototipo

Al finalizar, ninguna tarea queda `[ ]`: se hace con evidencia o se cierra con `Desvío:` + seguimiento.

## Fase 1 — Piezas compartidas

- [x] T001 `EncabezadoPagina`: título `.t1` (`h1`), descripción `.bl`, acciones a la derecha y pestañas opcionales. — evidencia: `apps/web/src/components/pagina/EncabezadoPagina.tsx`; tests en `EncabezadoPagina.test.tsx` (5).
- [x] T002 Nueva barra de herramientas de listado (búsqueda + píldoras + contador + ayuda) en `components/pagina`. — evidencia: `BarraHerramientas.tsx` + `BarraHerramientas.test.tsx` (3).
- [x] T003 Tema: píldoras de filtro separadas (`.chip.btn`), `MuiToggleButtonGroup`. — evidencia: `apps/web/src/tema/temaPanel.ts`.
- [x] T004 Tests de T001–T003. — evidencia: `pnpm exec vitest run src/components/pagina` (13 archivos, 123 tests verdes en la corrida de pantallas).

## Fase 2 — Ingreso

- [x] T005 `Login` con layout de dos paneles (marca oscura + formulario). — evidencia: `apps/web/src/pages/login.tsx` (panel `.t1`/`hero`, tiendas, formulario a la derecha).
- [x] T006 Test de `Login`. — evidencia: `src/pages/login.test.tsx` (5 verdes). Desvío: el error de credenciales NO se pinta en un `Alert` propio; lo sigue anunciando la notificación de Refine, porque hay un test existente que fija esa decisión (`un ingreso fallido no pinta un Alert propio`).

## Fase 3 — Listados

- [x] T007 Clientes: encabezado + barra de herramientas + tarjeta/tabla. — evidencia: `apps/web/src/pages/clientes/list.tsx`.
- [x] T008 Productos: encabezado + miniatura en la identidad + barra de herramientas (contador) + tarjeta/tabla. — evidencia: `apps/web/src/pages/productos/list.tsx`. Desvío: sin buscador propio porque el listado pagina en servidor y no hay hook de búsqueda; se cuenta el total del servidor.
- [x] T009 Empresas: encabezado + logo en la identidad + barra de herramientas + tarjeta/tabla. — evidencia: `apps/web/src/pages/empresas/list.tsx`.
- [x] T010 Usuarios: encabezado + barra de herramientas + avatar dentro de la identidad. — evidencia: `apps/web/src/pages/usuarios/list.tsx`.
- [x] T011 Roles: encabezado + títulos de tarjeta y de sección en la escala del prototipo (`.t3`/`.xs`). — evidencia: `apps/web/src/pages/roles/list.tsx`.
- [x] T012 Actividad: encabezado + texto de ayuda de la barra de filtros. — evidencia: `apps/web/src/pages/actividad/list.tsx`.
- [x] T013 Tests de los listados intervenidos. — evidencia: corrida de `vitest` (123 tests, 13 archivos) en el contenedor de dev; `tsc -b` limpio; `pnpm lint` 0 errores.

## Fase 4 — Cuenta y acceso

- [x] T014 Perfil: encabezado `.t1`, tarjetas y títulos internos alineados (`.t3`/`.xs`). — evidencia: `apps/web/src/pages/cuenta/perfil.tsx`.

## Fase 5 — Cierre

- [x] T015 `docs/sistema-de-diseno.md`: documentar piezas y alcance. — evidencia: sección «Paridad de pantallas (`paridad-pantallas`)».
- [x] T016 Verificación: `tsc -b`, `lint`, `estilos:check`, `docs:check` y tests en verde. — evidencia: `tsc -b` exit 0; `lint` 34 warnings / 0 errores; `pnpm estilos:check` limpio; `test:estilos:sueltos` 7/7; `docs:check` OK; `vitest` 123 verdes.

## Checkpoint

Al cerrar la Fase 3 el panel ya se ve como el prototipo en las pantallas implementadas; la Fase 5
deja la evidencia.

## Fuera de alcance (features sin dueño de datos)

No se muestran controles del prototipo que no tengan dueño: correo masivo, importar, etiquetas,
ranking por facturación, cuenta web, tiendas por cliente, filtro por tienda, stock, categorías,
«Visible en», precio/costo/margen en el listado de productos, selección múltiple con acciones
masivas y exportación masiva (Mercado Libre, newsletter, destacado). Quedan para sus épicas.
