# Bug Assessment: cobrar el precio promocional en POS y comprobantes (MSF-363, Decisión 6)

- **Slug**: msf-834
- **Created**: 2026-11-12
- **Source**: pasted text (ItsAPlan MSF-834; sin URL)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> "Gate: cobrar el precio promocional en POS y comprobantes (MSF-363, Decisión 6) (It's a Plan MSF-834) slug=msf-834"

El gate es la **Decisión 6** de la épica MSF-363 (`specs/20261104-103000-precios-masivos-y-promociones/`): «cobrar el precio promocional en POS, carrito y comprobantes». Nicolás la aprobó el 2026-11-12 («avanza con todo») y quedó registrada como pendiente en `specs/20261104-103000-precios-masivos-y-promociones/notas.md:22` y `docs/promociones-precio.md:32` como «aprobada, en implementación». El plan vive en ItsAPlan (MSF-834); no hay rama ni spec en el repo.

No hay ninguna URL en el reporte, así que no aplica la política de confianza de URLs.

## Symptom

La tienda pública de una empresa muestra el **precio promocional** (con el anterior tachado) mientras el **mostrador (POS) y los comprobantes** (facturas, presupuestos y sus copias) cobran el **precio normal** de lista/escala: el importe que se cobra no es el que el cliente vio anunciado. Lo esperado (Decisión 6 aprobada) es que POS y comprobantes cobren el precio vigente con promoción, con el mismo cálculo que ya usa la tienda.

## Reproduction

1. En la empresa E, programar una promoción de precio para el producto P (Productos → Promociones): `precio_promocional` sin IVA, `desde`/`hasta` que incluyan el ahora, empresa E.
2. Ver la tienda pública de E: catálogo y ficha de P muestran el precio promocional con el anterior tachado (`PrecioTachado`).
3. En Ventas → Mostrador de E, escanear P: la línea se guarda con el precio de **lista/escala**, no con el promocional; el total con IVA y el cobro (`registrarCobro`) salen de ese total.
4. En Ventas → comprobante (factura o presupuesto) de E, agregar P: mismo precio de lista/escala.
5. Copiar ese presupuesto a uno nuevo: vuelve a calcularse el precio de lista/escala (no el promocional).
6. Confirmar y cobrar: el comprobante factura el precio normal.

[NEEDS CLARIFICATION: no se reprodujo contra una instancia con Supabase local en este diagnóstico; la divergencia se confirma por lectura de código y por las pruebas pgTAP existentes que hoy fijan el precio sin promoción.]

## Suspected Code Paths

- `supabase/migrations/20270201200129_lineas_sin_stock.sql:706-712` — `public.guardar_lineas_comprobante` calcula el precio de cada línea con `private.precio_para(...)` y aplica el descuento del cliente (`v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2))`). Es el precio que queda grabado en `dominio.comprobantes_venta_lineas.precio_unitario` y el que se cobra.
- `supabase/migrations/20270213200002_precio_propio_tienda_y_lineas.sql:121-174` — `private.precio_para` (última definición): neto = precio propio de la empresa **o** `a_pesos(escala/precio_lista)` + `aplicar_regla_precio`. No hay ninguna referencia a `dominio.promociones_precio`: la promoción no puede entrar por esta vía.
- `supabase/migrations/20261204150100_copiar_presupuesto.sql:129-133` — `copiar_presupuesto` vuelve a calcular cada línea con `private.precio_para` (mismo camino que el POS).
- `supabase/migrations/20270221100003_promociones_precio_vigente.sql:30-48` (`private.promocion_vigente`) y `:77-92` (`private.precio_vigente_empresa`) — el cálculo con promoción **ya existe** y está probado, pero solo lo consumen las funciones públicas de la tienda.
- `supabase/migrations/20270221100004_tienda_precio_anterior.sql:64,156` y `supabase/migrations/20270221100005_tienda_precio_anterior_home_busqueda.sql:65,142,212` — catálogo, ficha, destacados, sugerencias y búsqueda de la tienda usan `private.precio_vigente_empresa`: de ahí que el local vea un precio y el mostrador cobre otro.
- `apps/web/src/lib/ventasMostrador.ts:61-83`, `apps/web/src/lib/ventasLineas.ts:91-97,146-153`, `apps/web/src/pages/ventas/mostrador.tsx:125,172-177,251-263` — el navegador nunca calcula precios: manda `precio_manual: null`, la base devuelve `precio_unitario`/`total_con_iva` y el POS cobra ese total. **El defecto no está en el front**: el front hace lo que el backend le dice.
- `docs/promociones-precio.md:32` y `specs/20261104-103000-precios-masivos-y-promociones/notas.md:22` — el gap ya está documentado como Decisión 6 «aprobada el 2026-11-12, en implementación».
- `supabase/migrations/20261211110100_precios_cliente_por_dominio.sql:66` — la cuenta web usa `private.precio_final_publico_escala` (tampoco promo; seguimiento MSF-816, Decisión 7, **fuera de alcance** de este gate).

## Root Cause Hypothesis

El precio de venta se resuelve en un único lugar, `private.precio_para`, y ese lugar **no conoce la promoción**: arma el neto desde el precio propio de la empresa o desde `precio_lista`/escala con la regla de ajuste de la empresa. La promoción, en cambio, vive en `dominio.promociones_precio` y solo se consulta desde `private.promocion_vigente`, que a su vez solo es llamado por `private.precio_vigente_empresa`, que a su vez solo es llamado por las **cinco funciones públicas de la tienda** (`publico.catalogo_pagina_por_dominio`, `publico.producto_por_dominio`, `publico.destacados_por_dominio`, `publico.busqueda_sugerencias`, `publico.busqueda_pagina_por_dominio`). El camino de ventas (`public.guardar_lineas_comprobante` → `private.precio_para`, y `public.copiar_presupuesto` → `private.precio_para`) nunca entra a ese cálculo. Es decir: **no es un error de fórmula sino una desconexión entre dos consumidores del precio**; el cálculo único quedó disponible para la tienda (Decisión 7) y el canal de ventas sigue con su propio camino. Confianza: **alta** (los dos caminos están en el código y ninguno de los dos lados tiene una condición que los cruce).

Estado del gate: `gh pr list` no muestra ningún PR abierto que implemente esta Decisión 6. El PR #868 (`fix/precios-por-tienda-y-bandera`, MSF-363) implementa **otras** decisiones de MSF-363 (precios masivos por tienda y bandera de apagado) y **no toca** el camino de ventas: su migración `20270228300100_promociones_precio_bandera.sql` solo hace que `private.promocion_vigente` devuelva `null` cuando la bandera `promociones_precio` está apagada. O sea: el gate sigue abierto y no está en curso en otro PR.

## Proposed Remediation

**Preferred**: una migración aditiva que haga que el camino de ventas consuma la promoción en el **neto**, sin reescribir la fórmula de IVA ni duplicar la consulta de promociones.

- Consumir `private.promocion_vigente(producto, empresa, now())` (el **neto** sin IVA de la promoción, o `null`) dentro de `private.precio_para`, de modo que el neto de partida sea el precio promocional cuando hay promoción vigente en esa empresa. Como `private.precio_para` solo lo usan `guardar_lineas_comprobante` y `copiar_presupuesto` (verificado: no lo usa la tienda ni la cuenta web), el cambio queda acotado al canal de ventas y ambos caminos quedan alineados de una sola vez.
- **No** usar `private.precio_vigente_empresa` tal cual: devuelve el precio ya con IVA si la empresa tiene activo el interruptor «Precios que ve el cliente», y `guardar_lineas_comprobante` calcula el IVA sobre el neto (`:717-722`): usarlo así duplicaría el IVA. El valor a inyectar es el neto de la promoción.
- Conservar el resto de la semántica de línea: `precio_manual` sigue mandando (`coalesce(v_manual, …)`), la alícuota sigue saliendo del producto/categoría, y el descuento fijo del cliente se sigue aplicando como hasta ahora (o no, según la decisión de negocio pendiente).
- Al reutilizar `private.promocion_vigente` (y no una consulta propia) la **bandera de apagado** del PR #868 (`20270228300100`) aplica automáticamente a ventas: si MSF-834 se mergea antes que #868, queda sin bandera hasta que #868 entre; conviene fijar el orden de merge.
- Documentar el cambio en `docs/promociones-precio.md` (cerrar la Decisión 6), `docs/ventas-comprobantes.md` (contrato de `guardar_lineas_comprobante` y `copiar_presupuesto`) y `docs/ventas-mostrador.md`, y cerrar el pendiente en `specs/20261104-103000-precios-masivos-y-promociones/notas.md`.

**Alternatives**:
- Calcular la promoción dentro de `public.guardar_lineas_comprobante` en vez de `private.precio_para`: duplica la regla de "qué promoción rige" y deja fuera a `copiar_presupuesto`, que volvería a cobrar el precio normal. Más rápido, peor.
- Crear una función nueva (`private.precio_para_venta`) en lugar de tocar `precio_para`: aísla el cambio semántico, pero duplica la fórmula de `precio_para` y multiplica la superficie a mantener; sólo conviene si negocio decide que la promoción **no** aplica a algún consumidor actual de `precio_para`.

**Files likely to change**:
- `supabase/migrations/<nueva>_precio_promocional_en_ventas.sql` (aditiva; `create or replace` de `private.precio_para` con su camino de reversión documentado)
- `supabase/tests/database/ventas_precios_especiales.test.sql` y/o nuevo `supabase/tests/database/ventas_precio_promocional.test.sql`
- `supabase/tests/database/promociones_precio.test.sql` (paridad venta ↔ tienda) y `supabase/tests/database/precios_escala.test.sql` / `precios_cliente.test.sql` (las paridades con `precio_para` cambian si hay promoción en el fixture)
- `docs/promociones-precio.md`, `docs/ventas-comprobantes.md`, `docs/ventas-mostrador.md`
- `specs/20261104-103000-precios-masivos-y-promociones/notas.md` (cerrar el pendiente de la Decisión 6) y `docs/roadmap-template.md` si el gate figura allí

**Tests to add or update**:
- pgTAP: con promoción **vigente** en la empresa del comprobante, `guardar_lineas_comprobante` guarda `precio_unitario` = precio promocional (neto) y el IVA se calcula sobre ese neto (sin doble IVA, con y sin interruptor «Precios que ve el cliente»).
- pgTAP: con promoción **programada, vencida o anulada**, la línea cobra el precio normal (sin cambios respecto de hoy).
- pgTAP: una promoción de **otra empresa** no afecta la línea (aislamiento por tienda).
- pgTAP: `precio_manual` sigue mandando sobre la promoción (si negocio lo confirma así).
- pgTAP: `copiar_presupuesto` copia el mismo precio que el original.
- pgTAP: con la bandera `promociones_precio` apagada (PR #868), la venta cobra el precio normal.
- pgTAP: el descuento del cliente mayorista y la escala x5/x10/x50, según la precedencia que se defina.
- Vitest: `apps/web/src/lib/ventasMostrador.test.ts` (el payload sigue mandando `precio_manual: null`: el precio lo pone la base) — no debería requerir cambios; `apps/web/src/pages/ventas/mostrador.test.tsx` como Smoke.

## Risks & Considerations

- **Doble IVA** si se inyecta `precio_vigente_empresa` en lugar del neto de `promocion_vigente`: es el error más probable de esta corrección.
- **Precedencia con la escala del mayorista**: `private.escala_para_linea` da x5/x10/x50 según cantidad (`20261203200300_lineas_rpc.sql:93-108`). Si la promoción pisa la escala, un mayorista puede pagar **más** que su precio de escala; si la escala pisa la promoción, el mostrador vuelve a differed de la tienda (que muestra x1). Es una decisión de negocio, no técnica.
- **Descuento fijo del cliente** (`clientes.descuento`, F-VTA-32): hoy multiplica el neto; hay que decidir si se aplica también sobre el precio promocional.
- **Precio propio por empresa** (F-PRE-08/MSF-352): la spec de MSF-363 ya resolvió que «la promoción se superpone al neto incluido el precio propio» — la promoción sustituye al precio propio.
- **Comprobantes ya guardados**: las líneas se recalculan al re-guardar (`docs/ventas-comprobantes.md:69`), así que un borrador guardado antes del cambio cambia de precio al re-guardarse. Los comprobantes confirmados no se recalculan (`confirmar_comprobante` no toca precios), por lo que no se altera la historia; conviene verificarlo con un caso explícito.
- **Sub-facturación** si la promoción se aplica mal (cobrar de menos en toda venta con promoción): es el riesgo de negocio del gate.
- **Alcance**: no cambia API pública, ni RLS, ni permisos; migración aditiva (sin tocar tablas). El `carrito` y **Mercado Libre** que menciona la Decisión 6 no existen en el repo (el carrito solo aparece en specs; no hay integración con Mercado Libre): quedan fuera de alcance salvo que el plan de MSF-834 los incluya.
- **Dependencia de orden con PR #868** (bandera de apagado): si MSF-834 entra primero, las ventas ignoran la bandera hasta que #868 se mergee.
- **Coordinación**: #868 también edita `docs/promociones-precio.md`, `specs/.../notas.md` y `specs/.../spec.md` — posibles conflictos de merge.

## Open Questions

- [NEEDS CLARIFICATION: precedencia entre el precio promocional y la escala del cliente mayorista (x5/x10/x50): ¿pisa la promoción o la escala?]
- [NEEDS CLARIFICATION: ¿el descuento fijo del cliente se aplica sobre el precio promocional o se excluye de las líneas promocionales?]
- [NEEDS CLARIFICATION: ¿la promoción aplica a las líneas con precio manual? (propuesta: no, el manual manda)]
- [NEEDS CLARIFICATION: ¿el mostrador debe **mostrar** que el precio es promocional (etiqueta o tachado)? El prototipo manda la UI y no tiene ítem para eso → fuera de alcance salvo que el plan lo pida.]
- [NEEDS CLARIFICATION: el gate menciona «carrito» y «Mercado Libre»; no hay carrito implementado ni integración con Mercado Libre en el repo. ¿El alcance de MSF-834 es POS + comprobantes (como dice el título)?]
- [NEEDS CLARIFICATION: ¿el plan de ItsAPlan (MSF-834) ya define estas precedencias? Si sí, cerrar acá las preguntas con ese texto.]
