---
owner: tecnico
sources:
  - specs
---

# Prototipos de UI y fidelidad de implementación

Los diseños de referencia viven en `design/pantallas/*.dc.html` (formato DesignCompose) y **mandan
la UI**: lo implementado debe verse y comportarse como el prototipo. Para que la divergencia no pase
desapercibida, el flujo es mecánico (no gustos):

1. **Inventario**: `node scripts/prototipo-inventario.mjs design/pantallas/<Pantalla>.dc.html`
   extrae el checklist (tablas+columnas, campos, botones, tabs, filtros, diálogos). Sobre una carpeta
   escribe `<Pantalla>.inventory.json` junto al `.dc.html` (generado, no editar a mano).
2. **Spec**: cada ítem del inventario mapea a un criterio de aceptación, o se declara fuera de alcance
   explícito (sección `## Matriz pantalla↔criterios`). Elemento visible sin dueño = spec incompleta.
3. **QA**: verifica que lo inventariado exista en lo implementado. Faltante mapeado y ausente = CAMBIOS.
4. **Timing**: sin prototipo linkeado no se aprueba spec de épicas con UI; un diseño que llega después
   es alcance nuevo (historias nuevas), no divergencia a barrer bajo la alfombra.

Ver `scripts/prototipo-inventario.mjs --help` (uso) y `scripts/prototipo-inventario.test.mjs` (tests).

## Qué lo hace mecánico (y no de palabra)

- **Inventario del prototipo en CI**: `pnpm prototipo:check` falla si algún
  `design/pantallas/**/*.dc.html` no tiene su `.inventory.json` o quedó
  desfasado. Se regenera con `pnpm prototipo:inventario` (determinista; sin LLM).
  Tests: `pnpm test:prototipo:inventario`.
- **Matriz en la spec**: `pnpm matriz:check` exige `## Matriz pantalla↔criterios`
  en toda spec **nueva** que mencione pantallas (`apps/web/src/pages`) o un
  prototipo (`design/pantallas`). Tests: `pnpm test:matriz:pantalla`. Las specs
  con UI anteriores a la vigilancia quedan en `scripts/matriz-pantalla-exentas.txt`
  (deuda explícita; no se agregan líneas sin motivo).
- **Empresa activa en la matriz**: la misma sección debe incluir «Empresa
  activa» (qué filtra, qué pasa al cambiarla) o «Empresa activa: no aplica» con
  el motivo. Sin esa fila, `pnpm matriz:check` falla. Es el Principio VIII de la
  constitución: nació de la regresión de Clientes con la barra superior, que se
  repitió en Productos, Servicios, Modelos y pop-ups.
- **Sin valores sueltos**: `pnpm estilos:check` (ya en CI) prohíbe colores y
  dimensiones literales en `apps/web/src/pages/**`: obliga a tokens/tema.
- **Tokens anclados al prototipo**: `apps/web/src/tema/tokens.test.ts` fija los
  valores del prototipo y falla si un token se desvía.
- **Comparación lado a lado** (manual, **no** gate): `pnpm --filter @platform/web
  pantallas:capturar` renderiza los `.dc.html` a PNG y, con `PANTALLAS_APP_URL`,
  también las rutas de la app. Un diff de píxeles no es gate porque los datos y
  las fuentes varían entre entornos.

Lo que **no** cubre: la posición/orden exactos dentro de una pantalla y el estilo
fino más allá de los tokens. Eso queda para la revisión visual con capturas.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
