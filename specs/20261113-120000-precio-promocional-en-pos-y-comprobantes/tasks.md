# Tasks: Precio promocional en el mostrador (POS) y en los comprobantes

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Épica**: MSF-816 (gate MSF-834)
Formato: `- [ ] T### [P] [STORY][US#] descripción`. **[P]** = paralelizable (archivos distintos y sin dependencia con otra tarea del mismo grupo). Dependencias y orden solo dentro de cada historia salvo que se indique. Cada FR/SC tiene **una sola** tarea dueña. Regla del repo: al implementar, toda tarea queda hecha con su evidencia o cerrada `[x]` con `Desvío: <motivo>` y su seguimiento trazado; ninguna queda `[ ]` al cerrar. Los estados `[ ]` de este archivo son los de una spec **aún sin implementar**.
Validación por fase: `pnpm lint`, `pnpm build`, `pnpm test` (con `pnpm dev:supabase`), `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`. Las migraciones usan `20270310100000…` y se **renumeran** al integrar con `dokploy` (plan, «Contexto técnico»).

## Fase 1 · F-1 · Precio en el servidor y snapshot — US1

- [ ] T001 [F-1][US1] Migración `supabase/migrations/20270310100000_comprobantes_lineas_promocion.sql`: `dominio.comprobantes_venta_lineas` + `precio_referencia numeric(14,2)` y `promocion_id uuid` (FK compuesta `(promocion_id, organizacion_id)` a `dominio.promociones_precio`, `on delete restrict`), `check` de que van juntas y `precio_referencia >= precio_unitario`, índice parcial por `promocion_id`; sin tocar filas existentes; reversión documentada (exportar, `drop column`, restaurar RPC). **FR-006, FR-007, FR-023**. **Verificación**: FR-006/007/023: pgTAP `ventas_precio_promocional.test.sql` (T005) y `pnpm docs:check`.
- [ ] T002 [P] [F-1][US1] Migración `20270310100100_precio_linea_venta.sql`: `private.promocion_vigente_fila(producto, empresa, ahora)` (`security definer`, `search_path = ''`, bandera + vigencia `[desde, hasta)`, sin `execute` para `anon`/`authenticated`) y `private.precio_linea_venta(...)` (envuelve `precio_para` + `escala_para_linea`, `least`, sin acumular, `p_ahora`, `p_aplicar_descuento`). Depende de T001 solo para el orden de versión. **FR-001, FR-002, FR-003, FR-013**. **Verificación**: FR-001/002/003/013: pgTAP `ventas_precio_promocional.test.sql` (T005).
- [ ] T003 [F-1][US1] Migración `20270310100200_lineas_precio_promocional.sql`: `guardar_lineas_comprobante` calcula con `precio_linea_venta` (manual sin referencia, `descuento_pct = 0` si ganó la promoción, guarda `precio_referencia`/`promocion_id`) y `obtener_comprobante` devuelve las claves nuevas; mismo cuerpo vigente (`20270201200129` / `20270201200132`) salvo lo indicado. Depende de T001 y T002. **FR-004, FR-005, FR-015**. **Verificación**: FR-004/005/015: pgTAP `ventas_precio_promocional.test.sql` (T005).
- [ ] T004 [P] [F-1][US1] Baseline de equivalencia: script/fixture dentro del pgTAP que calcula con la expresión legada `coalesce(manual, round(neto × (1 − d/100), 2))` y compara columna por columna (`precio_unitario`, `escala`, `descuento_pct`, `subtotal_sin_iva`, `iva`, totales) con la bandera apagada, en minorista, mayorista por cantidad, descuento, precio propio y exento. Depende de T003. **SC-002**. **Verificación**: SC-002: pgTAP `ventas_precio_promocional.test.sql` (T005) y la suite existente de comprobantes sin modificar.
- [ ] T005 [F-1][US1] pgTAP `supabase/tests/database/ventas_precio_promocional.test.sql`: una aserción por fila de la tabla de precedencia, snapshot, promoción por tienda A vs B, aislamiento entre dos organizaciones, vigencia en `desde`/`hasta` y **medianoche de Buenos Aires** (`p_ahora` = `23:59:59.999-03` y `00:00:00-03`), anulada, bandera apagada, permisos (solo `ventas` cobra la promoción; `anon` sin ejecución), inmutabilidad tras anular/editar/vencer la promoción de un comprobante confirmado, 200 líneas. Depende de T003. **SC-001, SC-003, FR-024**. **Verificación**: SC-001/003 y FR-024: `pnpm test` (pgTAP `ventas_precio_promocional.test.sql`; medición de 200 líneas en dev).
- [ ] T006 [F-1][US1] Mutación del servidor: mutar a mano (o por el registro declarativo si existe) `least`→`greatest`, `<`→`<=`, filtro `empresa_id`, `descuento_aplicado = 0` y bandera, y confirmar que cada mutante hace fallar T005; anotar el resultado en `notas.md`. Depende de T005. (Calidad de pruebas; sin FR propio).

**Checkpoint F-1**: migraciones aplicadas con `supabase db reset`, pgTAP nuevo y suite de comprobantes/precios existente verdes; nada visible cambia (bandera apagada).

Dentro de F-1: T001 → T002 → T003; T004 [P] y T005 ← T003; T006 ← T005.

## Fase 2 · F-2 · Mostrador y comprobante — US2 (depende de F-1; bloqueada por la Decisión 7 del prototipo)

- [ ] T007 [F-2][US2] Prototipo: con la aprobación de Nicolás (Decisión 7), sumar al prototipo `design/pantallas/VentasComprobante.dc.html` la celda de precio con referencia tachada + leyenda «Promoción» y el aviso «Los precios cambiaron», regenerar con `pnpm prototipo:inventario` y verificar `pnpm prototipo:check`. (Soporte de FR-016/FR-018; sin FR propio).
- [ ] T008 [P] [F-2][US2] `apps/web/src/lib/ventasLineas.ts` y `lib/ventas.ts`: tipos y mapeo de `precio_referencia`/`promocion_id`, `lineaEnPromocion`. (Soporte de FR-015 desde el cliente; sin FR propio). **Verificación**: Vitest `ventasLineas.test.ts`.
- [ ] T009 [F-2][US2] `components/ventas/LineasComprobante.tsx`: celda de precio con cobrado + referencia tachada + «Promoción», accesible (textos «Precio promocional» y «Precio anterior»); precio manual sin leyenda; sin tocar edición de precio ni rótulo de escala. Depende de T007 y T008. **FR-016**. **Verificación**: FR-016: Vitest `LineasComprobante.test.tsx` (con axe a 320/768/1440 px).
- [ ] T010 [F-2][US2] `pages/ventas/mostrador.tsx`: la tabla de líneas usa la misma celda; el total no cambia de estructura. Depende de T009. **FR-017**. **Verificación**: FR-017: Vitest `mostrador.test.tsx` y E2E `apps/web/e2e/ventas-mostrador-promocion.e2e.ts` (T012).
- [ ] T011 [F-2][US2] Manejo de «precios cambiaron»: `lib/ventasConfirmacion.ts` y `lib/ventasMostrador.ts` reconocen `40001` con `hint = 'precios_cambiaron'` antes del mapeo genérico; `mostrador.tsx` y `comprobante.tsx` re-guardan las líneas (mismas cantidades y precios manuales), muestran el aviso con el patrón compartido y **no** reintentan el cobro. Depende de T010. **FR-018**. **Verificación**: FR-018: Vitest `mostrador.test.tsx`, `comprobante.test.tsx` y E2E (T012).
- [ ] T012 [F-2][US2] E2E contra el build: `apps/web/e2e/ventas-mostrador-promocion.e2e.ts` (nuevo; siembra por API admin, solo Supabase local, como `ventas-mostrador.e2e.ts`): escaneo de producto en promoción con tachado y leyenda, cobro al precio promocional con total del comprobante = total del cobro, y venta cuyo precio cambia antes de cobrar. Depende de T011. **SC-004**. **Verificación**: SC-004: Playwright `ventas-mostrador-promocion.e2e.ts` (con `pnpm dev:supabase`; si no se puede ejecutar, se anota el desvío y su seguimiento).
- [ ] T013 [P] [F-2][US2] Vitest de comprobante entre tiendas: comprobante de B abierto con A activa muestra precios de B; «Todas mis empresas» no habilita el mostrador. Depende de T009. **FR-014**. **Verificación**: FR-014: pgTAP `ventas_precio_promocional.test.sql` (T005, tienda A vs B) y Vitest `comprobante.test.tsx`.

**Checkpoint F-2**: Vitest y E2E del mostrador verdes; `pnpm matriz:check` y `pnpm prototipo:check` verdes.

Dentro de F-2: T007 y T008 [P] arrancan juntas; T009 ← T007+T008; T010 ← T009; T011 ← T010; T012 ← T011; T013 [P] ← T009.

## Fase 3 · F-3 · Confirmación, presupuestos y devoluciones — US3 (depende de F-1; paralela a F-2)

- [ ] T014 [F-3][US3] Migración `20270310100300_confirmar_comprobante_precios_vigentes.sql`: `private.lineas_con_promocion_desactualizada(comprobante, ahora)` y guarda al inicio de `public.confirmar_comprobante` (`40001`, `hint = 'precios_cambiaron'`, antes de tocar stock/costos/estado; no actúa con la bandera apagada ni sobre facturas ya confirmadas); cuerpo vigente de `20270216400000`. **FR-009**. **Verificación**: FR-009: pgTAP `ventas_precio_promocional_ciclo.test.sql` (T017).
- [ ] T015 [P] [F-3][US3] Migración `20270310100400_copiar_presupuesto_y_notas_precio_promocional.sql`: `copiar_presupuesto` usa `precio_linea_venta` sin descuento (conserva el precio manual) y guarda las dos columnas; `private.copiar_costo_linea_nota` copia también `precio_referencia` y `promocion_id`; reversión documentada. **FR-010, FR-011**. **Verificación**: FR-010/011: pgTAP `ventas_precio_promocional_ciclo.test.sql` (T017).
- [ ] T016 [P] [F-3][US3] Presupuestos: verificar y fijar que `aceptar_presupuesto` no reprecia y que un presupuesto `pendiente` conserva el precio guardado hasta `valido_hasta` (sin código nuevo si ya es así; si hay que tocar algo, se hace aquí). **FR-008**. **Verificación**: FR-008: pgTAP `ventas_precio_promocional_ciclo.test.sql` (T017).
- [ ] T017 [F-3][US3] pgTAP `supabase/tests/database/ventas_precio_promocional_ciclo.test.sql`: guarda de confirmar (rechazo sin efectos sobre stock, costos, estado y cobros; promoción vencida y promoción nueva; confirmación normal; idempotencia; bandera apagada; línea manual excluida), copiar presupuesto, nota de crédito total y parcial al precio cobrado con herencia de columnas, saldo neto (`private.saldo_comprobante`) y cobros, abono de motos sobre factura promocional, IVA 21 % y exento. Depende de T014, T015 y T016. **FR-012, SC-002**. **Verificación**: FR-012: `pnpm test` (pgTAP `ventas_precio_promocional_ciclo.test.sql`).
- [ ] T018 [F-3][US3] Edición manual: pgTAP de que sin `editar_precio` el precio manual falla (`42501`), con permiso manda sobre la promoción, deja `precio_manual = true` sin referencia y el evento `comprobante.editado`. Depende de T014. **FR-019**. **Verificación**: FR-019: pgTAP `ventas_precio_promocional_ciclo.test.sql` (T017).
- [ ] T019 [F-3][US3] Mutación de la guarda: mutar la comparación de `promocion_id` y la tolerancia `0.005`, y el orden de la guarda respecto del movimiento de stock; cada mutante debe fallar T017; anotar en `notas.md`. Depende de T017. (Calidad de pruebas; sin FR propio).

**Checkpoint F-3**: pgTAP del ciclo y suite existente (`comprobante_*`, `cobros_comprobante`, `ventas_motos_*`) verdes.

Dentro de F-3: T014, T015 y T016 [P] arrancan juntas; T017 ← T014+T015+T016; T018 ← T014; T019 ← T017.

## Fase 4 · F-4 · Consistencia, reportes, API, documentación — US4 (depende de F-1 y F-3)

- [ ] T020 [F-4][US4] Paridad tienda↔local: pgTAP del neto del local contra `private.precio_vigente_empresa` para un conjunto de productos/tiendas/instantes (minorista, cantidad 1, sin descuento, sin interruptor de IVA), y la cota < $1 con «Precios con IVA». **FR-020**. **Verificación**: FR-020: pgTAP `ventas_precio_promocional_paridad.test.sql`.
- [ ] T021 [P] [F-4][US4] Reportes, exportación y API: pgTAP de rentabilidad realizada sobre una venta con promoción, de que la exportación total incluye las columnas nuevas y `pnpm test:openapi` sin diff; confirmar y documentar que `analitica.margen_producto_canal` queda con el precio normal (Decisión 8). **FR-021**. **Verificación**: FR-021: pgTAP de rentabilidad/exportación y `pnpm test:openapi`.
- [ ] T022 [P] [F-4][US4] Decisión 2 (si se aprueba): `private.precio_vigente_empresa` y `guardar_promocion_precio` ignoran/avisan la promoción ≥ precio normal, con el rendimiento de MSF-846 intacto. Si no se aprueba: cerrar `[x]` con `Desvío: Decisión 2 no aprobada` y el seguimiento. (Soporte de FR-003, parte tienda; sin FR propio). **Verificación**: pgTAP `promociones_precio.test.sql` ampliado (suite existente sin romper).
- [ ] T023 [F-4][US4] Documentación y ayuda: `docs/ventas-comprobantes.md`, `docs/ventas-mostrador.md`, `docs/promociones-precio.md` (Decisión 6 «implementada», orden de encendido), `docs/precios.md`, `docs/deployment.md` (gate: no encender `promociones_precio` en PRD antes de estar en dev y verificada), ayuda de Ventas en `apps/web/src/ayuda/contenidos/ventas.ts`; spec de MSF-363 con la nota de cierre de la Decisión 6. Depende de T020 y T021. **FR-022**. **Verificación**: FR-022: `pnpm docs:check` y `ayuda-cobertura.test.ts`.
- [ ] T024 [P] [F-4][US4] Verificar versiones de migración contra `origin/dokploy` y los PRs abiertos, renumerar si hace falta y que cada encabezado traiga su reversión. (Soporte de FR-023; sin FR propio). **Verificación**: `pnpm docs:check` (guard de migraciones).

Dentro de F-4: T020, T021, T022 y T024 [P]; T023 ← T020+T021.

## Fase 5 · [CIERRE]

- [ ] T025 [CIERRE] Verificación en dev **contra el bundle y el esquema desplegados** (no basta con el merge): función `private.precio_linea_venta` presente, columnas nuevas, bandera apagada con comportamiento idéntico; luego encender la bandera **solo en dev** y recorrer: promoción en tienda y en mostrador, cobro, nota de crédito, venta con vencimiento a mitad. Dejar la bandera como decida Nicolás y **apagada en stg y prd**. **SC-005**. **Verificación**: SC-005: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check` y captura/línea de evidencia del recorrido en dev.
- [ ] T026 [CIERRE] Actualizar `docs/roadmap-template.md` (estado de la fila de la épica, link a la spec y a la guía), cerrar con merge commit de cada PR de fase, trazar los seguimientos S1–S4 como Tareas `seguimiento` y cerrar toda tarea con evidencia o `Desvío`. (Cierre manual con criterio; sin FR propio).

## Cobertura FR/SC → tarea dueña

| FR/SC | Tarea | FR/SC | Tarea |
|---|---|---|---|
| FR-001, FR-002, FR-003, FR-013 | T002 | FR-014 | T013 |
| FR-004, FR-005, FR-015 | T003 | (soporte cliente de FR-015) | T008 |
| FR-006, FR-007, FR-023 | T001 | FR-016 | T009 |
| FR-008 | T016 | FR-017 | T010 |
| FR-009 | T014 | FR-018 | T011 |
| FR-010, FR-011 | T015 | FR-019 | T018 |
| FR-012 | T017 | FR-020 | T020 |
| FR-021 | T021 | FR-022 | T023 |
| FR-024, SC-001, SC-003 | T005 | SC-002 | T004 |
| SC-004 | T012 | SC-005 | T025 |
