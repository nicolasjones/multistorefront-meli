# Bug Assessment: Clientes — migrar `public.clientes` a `dominio`, y corregir búsqueda, exportación y auditoría (MSF-882)

- **Slug**: msf-882
- **Created**: 2026-11-14
- **Source**: pasted text (tracker MSF-882, «[Lote L22] Clientes: migrar `public.clientes`, búsqueda/exportación y auditoría (4 bugs consolidados)»); sin URL
- **Verdict**: valid
- **Severity**: high

## Report (verbatim)

> ## [Lote L22] Clientes: migrar `public.clientes`, búsqueda/exportación y auditoría (4 bugs consolidados)
>
> Es un Plan (MSF-882). El enunciado consolida cuatro hallazgos de Clientes en un solo lote: (1) el traslado de `public.clientes` al esquema `dominio`; (2) la búsqueda por texto; (3) la exportación a Excel; (4) la auditoría de esas operaciones.

> **Nota de este assessment:** el plan del lote no viaja con el reporte (no hay archivo, spec ni issue en el repo que lo detaille). Los cuatro bugs se reconstruyeron desde el código y la documentación del repo, y se enuncian abajo con su evidencia. Lo que no se pudo reconstruir —el alcance exacto que el plan daba a cada punto— queda como [NEEDS CLARIFICATION].

## Los cuatro bugs consolidados (reconstrucción con evidencia)

| # | Bug | Evidencia en el repo |
|---|---|---|
| 1 | `public.clientes` (y `public.clientes_empresas`) siguen en el esquema `public` aunque Clientes es una entidad de negocio: la excepción documentada al Principio VII sigue abierta (deuda MSF-505) | `docs/tecnico/datos.md:19-25`, `docs/tecnico/clientes.md:35` y `:442`, `docs/clientes.md:162` |
| 2 | La búsqueda por texto **dejó de poder usar el índice trigram**: el predicado de `public.buscar_clientes` incluye `expreso_preferido` desde `20261017120001`, pero `clientes_busqueda_trgm_idx` sigue cubriendo la expresión *sin* esa columna → Postgres exige coincidencia exacta de la expresión → el índice no es utilizable | `20261016130000_clientes_ficha_y_numeracion.sql:187-190`, `20261016160000_clientes_habilitar_pg_trgm.sql:21-26` vs. `20261017120001_clientes_expreso_preferido.sql:66`, `20261211100250_buscar_clientes_cuenta_web.sql:106-108` |
| 3 | La exportación **no coincide con la pantalla**: el predicado de `public.exportar_clientes` no incluye `expreso_preferido` (sí lo incluye el de búsqueda) → el `.xlsx` puede traer menos filas que el listado que muestra los mismos filtros | `20261211100250_buscar_clientes_cuenta_web.sql:192-194` y `:226-228` vs. `:106-108`; promesa del diálogo en `apps/web/src/components/clientes/ExportarClientes.tsx:51` |
| 4 | La exportación de clientes **no deja rastro en la actividad**: la RPC es `stable` y no escribe nada (deuda MSF-508, requisito de auditoría, Principio III) | `20261211100250_buscar_clientes_cuenta_web.sql:155-157`, `docs/clientes.md:191-193`, `docs/tecnico/clientes.md:443` |

## Symptom

1. **Esquema**: Clientes es negocio y vive en `public` junto a la plataforma; el traslado a `dominio` quedó trazado como deuda (MSF-505) y nunca se hizo.
2. **Búsqueda**: la pantalla de Clientes es la más usada y su búsqueda por texto («Nombre, DNI/CUIT, correo, teléfono, localidad o número») recorre `public.clientes` completa en cada consulta con texto: el índice GIN trigram que debía atenderla quedó alineado con otra expresión y el planificador ya no lo puede usar. El pgTAP que vigila ese índice (`clientes_plan_indices.test.sql`) prueba la expresión vieja, así que el CI sigue en verde y la regresión no se ve.
3. **Exportación**: con el mismo texto de búsqueda, el listado muestra N clientes y el `.xlsx` sale con menos (o con cero) porque el filtro de texto de la exportación no contempla `expreso_preferido`; el diálogo promete «todos los que coinciden con la búsqueda y los filtros actuales».
4. **Auditoría**: nadie puede demostrar que una organización exportó la lista de clientes (datos de contacto) porque la operación no genera evento en `public.registro_actividad`; el precedente ya existe para la exportación de la actividad (`actividad.exportada`).

## Reproduction

1. **Búsqueda sin índice (bug 2)** — con `pnpm dev:supabase` y ~5.000 clientes (seed del propio pgTAP):
   `supabase/verificacion/clientes_explain.sql` corre el `EXPLAIN` con la expresión *sin* `expreso_preferido` y el plan usa `clientes_busqueda_trgm_idx` (por eso el script y el CI dicen que todo va bien). El predicado que la app manda es el de `public.buscar_clientes` (`20261211100250_buscar_clientes_cuenta_web.sql:106-108`), que **sí** incluye `coalesce(c.expreso_preferido, '')`: con esa expresión el planificador no puede usar el índice (no coincide con la expresión indexada) y cae en un Seq Scan sobre `public.clientes`.
   [NEEDS CLARIFICATION: la confirmación con `EXPLAIN (ANALYZE, BUFFERS)` sobre la expresión vigente requiere una base local; en este entorno no se ejecutó ningún motor. La verificación queda para la etapa de test.]
2. **Exportación que no coincide con la pantalla (bug 3)** — en `/clientes`: cargar un cliente con `expreso_preferido` = «Cargo Express», escribir «Cargo» en el buscador (el listado lo encuentra: el predicado de búsqueda incluye el expreso) y pulsar «Exportar» con ese filtro: `exportar_clientes` aplica otro predicado (`20261211100250_buscar_clientes_cuenta_web.sql:226-228`), sin el expreso, y el archivo sale vacío o incompleto mientras el diálogo anuncia el total del listado.
3. **Auditoría (bug 4)** — con permiso `exportar` en Clientes: exportar y revisar Actividad → no hay ningún evento de la exportación (ni `cliente.exportado` ni `actividad.exportada`): la RPC es `stable` y no escribe (`20261211100250_buscar_clientes_cuenta_web.sql:155-157`).
4. **Esquema (bug 1)** — estático: existe `public.clientes` y no existe `dominio.clientes`; `docs/tecnico/datos.md:19-25` lo declara como excepción abierta y `docs/tecnico/clientes.md:442` la lista como deuda (MSF-505).

## Suspected Code Paths

- `supabase/migrations/20261016130000_clientes_ficha_y_numeracion.sql:187-190` — crea `clientes_busqueda_trgm_idx` sobre la expresión de texto **sin** `expreso_preferido` (la columna ni existía).
- `supabase/migrations/20261016160000_clientes_habilitar_pg_trgm.sql:19-27` — segunda creación del mismo índice (`if to_regclass(...) is null`), con la misma expresión vieja.
- `supabase/migrations/20261017120001_clientes_expreso_preferido.sql:66` — introduce `coalesce(c.expreso_preferido, '')` en el predicado de `buscar_clientes`; a partir de acá la expresión consultada deja de coincidir con la indexada (bug 2).
- `supabase/migrations/20261211100250_buscar_clientes_cuenta_web.sql:23-112` — versión vigente de `public.buscar_clientes` (`security invoker`, predicado con expreso en `:106-108`, `limit/offset` en `:110-111`).
- `supabase/migrations/20261211100250_buscar_clientes_cuenta_web.sql:129-233` — versión vigente de `public.exportar_clientes` (`language plpgsql` + `stable` + `security definer` en `:155-157`; predicado **sin** expreso en `:192-194` y `:226-228`; sin ninguna llamada a `private.insertar_actividad` → bug 4).
- `supabase/migrations/20261016130200_clientes_rls_por_seccion_y_actividad.sql:82-122` — `private.registrar_actividad_cliente()` + trigger `clientes_registrar_actividad`: la auditoría de escritura de clientes vive acá y **no** cubre la exportación (bug 4).
- `supabase/migrations/20270207100001_registro_inalterable_antes_despues.sql:53-80` — catálogo `public.tipos_evento_actividad` (los `cliente.*` son no sensibles; un tipo nuevo se da de alta por migración).
- `supabase/migrations/20270214300001_exportar_actividad_cursor.sql:31-40` y `supabase/migrations/20270217900001_exportar_actividad_constancia_servidor.sql` — **precedente** de auditoría de exportaciones: `private.exportaciones_actividad` + evento `actividad.exportada`, con id por corrida y límite por hora. Es el molde para registrar la exportación de clientes.
- `apps/web/src/hooks/useBuscarClientes.ts:56-64` — el navegador manda `p_texto` a `buscar_clientes` (sin saber que el backend no puede indexarlo).
- `apps/web/src/lib/exportarClientes.ts:91-110` — el navegador manda `p_texto` a `exportar_clientes` (y `p_empresa_id`, `p_con_cuenta_web`).
- `apps/web/src/components/clientes/ExportarClientes.tsx:51` — texto que promete «todos los que coinciden con la búsqueda y los filtros actuales» (el punto exacto donde se rompe la promesa del bug 3).
- `apps/web/src/pages/clientes/list.tsx:137-157, 198` — la pantalla pide página N a `useBuscarClientes`, acumula con `useListadoAcumulado` y pasa los filtros a `ExportarClientes`.
- `supabase/tests/database/clientes_plan_indices.test.sql:74-83` y `supabase/verificacion/clientes_explain.sql:34-42` — la verificación del índice prueba la expresión **anterior** a `expreso_preferido`: por eso el CI no ve la regresión del bug 2.
- `docs/tecnico/clientes.md:442-444` y `docs/clientes.md:160-164, 181-199` — la deuda trazada (MSF-505, MSF-508) que este lote cierra.
- Para el bug 1, el radio de impacto: `public.clientes` aparece ~270 veces en 95 migraciones y es leída por del orden de 60–70 funciones `public.*`/`private.*` (comprobantes, ventas, envíos, faltantes, fusionar, ranking, cuenta corriente, consultas, presupuestos de tienda, correo masivo, Service). PostgREST: `supabase/config.toml:16` ya expone `dominio`, pero el panel lee la tabla con `.from('clientes')` en `apps/web/src/lib/ventas.ts:194`, `apps/web/src/lib/ventasMostrador.ts:39`, `apps/web/src/lib/reparacionAvisos.ts:74`, `apps/web/src/components/clientes/HojaEtiquetas.tsx:48` y `apps/web/src/hooks/useOpcionesDimension.ts:79`; los pgTAP usan `public.clientes` en 64 aserciones. Además, la exportación total (worker `workers/exportar-organizacion/`) se arma con la lista explícita de `private.conjuntos_exportacion_total()`, que hoy nombra `('public', 'clientes')` y `('public', 'clientes_empresas')` (`supabase/migrations/20270220170000_exportacion_total_variantes_y_relacionados.sql:107-108`, entre otras) → al mover la tabla cambia el nombre de la carpeta del CSV.

## Root Cause Hypothesis

Confianza **alta** en los bugs 2 y 3, **media-alta** en el 4 y **alta** en el 1. Los cuatro son la misma clase de problema: la tabla de Clientes se modificó por capas (ficha → empresas/tiendas → expreso preferido → cuenta web) y cada capa **duplicó la definición del filtro de texto** en lugar de reusarla. El índice GIN quedó congelado en la primera versión de esa expresión; la búsqueda la movió (agregando el expreso) y la exportación no. Resultado: la búsqueda Slow (índice inutilizable) y la exportación incompleta (filtro distinto), con un guard que vigila la expresión equivocada. El bug 4 es la deuda MSF-508 ya conocida: la RPC de exportación nació `stable` para poder cachearse y así no pudo escribir en el historial; hoy el repo ya tiene el patrón resuelto para la exportación de la actividad (`actividad.exportada` + `private.exportaciones_actividad`), que es el molde a copiar. El bug 1 es deuda explícita (MSF-505): `public.clientes` quedó en `public` por una excepción documentada que nunca se levantó, y hoy el resto del negocio ya vive en `dominio`.

## Proposed Remediation

**Preferred** — un lote con cuatro migraciones (más sus pruebas y documentación), en este orden:

**(a) Una sola definición del filtro de texto (bugs 2 y 3).** Crear un ayudante inmutable, por ejemplo `private.texto_busqueda_cliente(nombre, documento, correo, telefono, celular, localidad, expreso_preferido, numero) → text` (la concatenación en minúsculas que ya usan ambas RPC), recrear **las dos** RPC para llamarlo, y **reconstruir el índice** sobre esa misma llamada (`drop index clientes_busqueda_trgm_idx; create index clientes_busqueda_trgm_idx on public.clientes using gin (private.texto_busqueda_cliente(nombre, documento, correo, telefono, celular, localidad, expreso_preferido, numero) gin_trgm_ops)`). Con un índice por expresión de función `immutable`, el predicado coincide exactamente y el planificador lo usa; la búsqueda y la exportación quedan con el mismo filtro y el archivo coincide con la pantalla. Actualizar de paso el guard: el pgTAP y el script manual tienen que usar la expresión vigente (o la llamada al ayudante), no la vieja.

**(b) La exportación deja rastro (bug 4).** Pasar `public.exportar_clientes` a `volatile` y registrar el evento **en la primera tanda** (`p_despues_de is null`, que es la que conoce el total real), con `private.registrar_actividad('cliente.exportado', …)` y un tipo nuevo no sensible dado de alta en `public.tipos_evento_actividad`. El detalle lleva el total y los filtros «en palabras» (sin ids, sin datos de contacto, como el precedente `actividad.exportada`), y la organization y el actor salen de la sesión (`private.registrar_actividad` los resuelve). Si se quiere el mismo rigor del precedente de Actividad, agregar `private.exportaciones_clientes_actividad` (id por corrida, `entregadas`, `cerrada`, límite por hora) para que la constancia se escriba al pedir los datos y no dependa de que el navegador termine la descarga. El filtro que se registra es el de la primera tanda: las siguientes no pueden cambiarlo.

**(c) `public.clientes` → `dominio.clientes` (bug 1).** Migración propia con `alter table public.clientes set schema dominio;` (la tabla se mueve con sus políticas, sus disparadores, sus índices y sus datos) y recreación de **todas** las funciones vivas que la leen, con el esquema nuevo. Después: `public.clientes_empresas` y `public.cuentas_cliente` (que también son negocio y hoy están en `public`) pasan al mismo esquema en la misma migración o en una inmediatamente posterior, con su reversión escrita. Actualizar los 5 call sites de PostgREST a `.from('dominio.clientes')` (el esquema `dominio` ya está expuesto: `supabase/config.toml:16`), los pgTAP que nombran `public.clientes` (64 aserciones) y los que la nombran sin cualificar (el `search_path` de la sesión de test tiene que incluir `dominio`), y la documentación (`docs/tecnico/datos.md`, `docs/tecnico/clientes.md`, `docs/clientes.md`) incluida la DER de la spec. Cerrar MSF-505 en la deuda trazada.

**Alternatives**:
- **(c-1) Vista de compatibilidad** en vez de recrear las funciones: mover la tabla y dejar `public.clientes` como vista (`security_invoker = true`, para que mande la RLS de `dominio.clientes`). Las funciones ya aplicadas siguen resolviendo `public.clientes` y no hay que recrearlas. Trade-off: quedan dos nombres para lo mismo (justo lo que el traslado quiere eliminar), la vista congela el juego de columnas al crearse (hay que recrearla cada vez que `dominio.clientes` suma una columna) y las escrituras por la vista no pasan por los `grant` por columna. Sirve como puente de un PR, no como estado final.
- **(c-2) Cierre documental**: dejar `public.clientes` en `public` como excepción permanente (actualizar `docs/tecnico/datos.md` y `docs/tecnico/clientes.md`, sacar MSF-505 de la deuda) sin tocar el esquema. Cero riesgo y cero costo, pero no cumple el Principio VII y deja la excepción para siempre.
- **(b-1) Registro desde el cliente**: que el panel llame a una RPC de auditoría aparte antes de exportar. Trade-off: el rastro depende del navegador (si la pestaña se cierra, no queda registro) y contradice el principio de que la base registre en la misma transacción. El propio repo lo descarta en `docs/clientes.md:191-193`.
- **(a-1) Índice por columnas** en vez de por expresión (un GIN por columna con `gin_trgm_ops` y `lower(...)`): el predicado por columnas no usa índices trigram, así que la vía simple es un índice de expresión única (la propuesta) o un `search`-style sobre un array (más complejo de lo que pide el lote).

**Files likely to change**:
- `supabase/migrations/<nuevo>_clientes_busqueda_unificada.sql` (ayudante + recreación de `buscar_clientes` y `exportar_clientes` + reconstrucción de `clientes_busqueda_trgm_idx`)
- `supabase/migrations/<nuevo>_clientes_exportar_actividad.sql` (evento `cliente.exportado` + `volatile` + catálogo)
- `supabase/migrations/<nuevo>_clientes_a_dominio.sql` (traslado + recreación de las funciones vivas + `clientes_empresas`/`cuentas_cliente`)
- `supabase/migrations/<nuevo>_exportacion_total_conjuntos_dominio.sql` (o el ajuste de `private.conjuntos_exportacion_total()`: `('public','clientes')` → `('dominio','clientes')`)
- `supabase/tests/database/clientes_plan_indices.test.sql` (la expresión del guard, que hoy prueba la vieja)
- `supabase/tests/database/clientes_busqueda_exportacion.test.sql`, `clientes_alta_y_edicion.test.sql`, `clientes_filtro_tienda.test.sql`, `clientes_empresas.test.sql` y los demás pgTAP que nombran `public.clientes`
- `supabase/verificacion/clientes_explain.sql` (expresión vigente)
- `apps/web/src/lib/ventas.ts`, `apps/web/src/lib/ventasMostrador.ts`, `apps/web/src/lib/reparacionAvisos.ts`, `apps/web/src/components/clientes/HojaEtiquetas.tsx`, `apps/web/src/hooks/useOpcionesDimension.ts` (`.from('dominio.clientes')`)
- `apps/web/src/lib/exportarClientes.ts` y su test (si el contrato de la RPC cambia)
- `docs/clientes.md`, `docs/tecnico/clientes.md`, `docs/tecnico/datos.md`, `docs/actividad.md` (evento nuevo), `docs/api.md`

**Tests to add or update**:
- pgTAP: el plan de la búsqueda **vigente** (con `expreso_preferido`) usa `clientes_busqueda_trgm_idx` — el guard que hoy no lo detectaría (bug 2).
- pgTAP: con el mismo texto, `buscar_clientes` y `exportar_clientes` devuelven el mismo conjunto (mismo total y mismos ids) —including un cliente que solo coincida por `expreso_preferido` (bug 3).
- pgTAP: la exportación deja un evento `cliente.exportado` con el total real, en la primera tanda y no en las siguientes, y solo con sesión (bug 4).
- pgTAP: `dominio.clientes` existe y `public.clientes` ya no; las políticas, el trigger de actividad, los índices y los `grant` por columna siguen vigentes; el aislamiento entre organizaciones sigue verde (`aislamiento_organizaciones.test.sql` y los demás control positivo) (bug 1).
- Vitest: `lib/exportarClientes.test.ts` y `components/clientes/ExportarClientes.test.tsx` (filtros que llegan a la RPC, texto de la promesa).
- E2E (MSF-499 sigue pendiente de fixtures por rol): el caso «alta, búsqueda y exportación» de `docs/e2e-app.md` cubre el recorrido una vez que haya fixtures.

## Risks & Considerations

- **Radio del traslado (bug 1)**: es el cambio más caro del lote. ~270 referencias a `public.clientes` en 95 migraciones y del orden de 60–70 funciones vivas que la leen (comprobantes, ventas, envíos, faltantes, fusionar, ranking, cuenta corriente, consultas, presupuestos de tienda, correo masivo, Service). Una función olvidada se rompe en runtime, no en la migración: el inventario exacto hay que sacarlo de `pg_depend`/`pg_get_functiondef` en la base, no de una búsqueda de texto. El `FK` de `public.clientes_identificadores_externos` sigue a la tabla al moverla, pero hay que verificarlo. El disparador de actividad y las políticas se mueven con la tabla; los `grant` por columna también.
- **RLS**: mover la tabla no puede relajar el aislamiento por organización ni por sección; el control positivo de `aislamiento_organizaciones.test.sql` y de los demás pgTAP tiene que quedar verde antes y después.
- **PostgREST y el panel**: `dominio` está expuesto (`supabase/config.toml:16`) pero `.from('clientes')` deja de resolver; los 5 call sites y cualquier consulta del panel o de un worker que use el nombre sin esquema hay que revisarlos (workers/ y Kestra también leen la base: buscar `from('clientes')` y `public.clientes` fuera de `apps/web`). La exportación total nombra la tabla en `private.conjuntos_exportacion_total()`: al moverla, el `.csv` pasa de `public/clientes.csv` a `dominio/clientes.csv` (cambio de nombre del archivo entregable, hay que avisarlo).
- **Índice (bug 2)**: reconstruir el GIN sobre `public.clientes` (o sobre `dominio.clientes`) bloquea la tabla mientras se construye; con volumen grande conviene `create index concurrently` (no puede ir dentro de una transacción de migración) o una ventana de mantenimiento. El guard actual usa `enable_seqscan = off` y `enable_indexscan = off` y descarta el btree de organización para no depender de empates de costo: hay que replicar ese cuidado con la expresión nueva, y no volver a convertirlo en un test que pasa por construcción.
- **Volumen de la exportación (bug 4)**: registrar en la actividad en la primera tanda no agrega una consulta pesada, pero `exportar_clientes` pasa a `volatile` y pierde el snapshot cacheable; conviene medir que la primera tanda no se encarece (el total ya se cuenta ahí).
- **PII en el detalle del evento**: el detalle del evento nuevo no debe llevar correos ni teléfonos (mismo criterio que `cliente.editado` y que `actividad.exportada`); solo el total y los filtros en palabras.
- **Regresión de la búsqueda**: cambiar el predicado de texto agrega el expreso a la búsqueda por defecto → el conjunto de resultados del buscador cambia (más filas). Es el comportamiento esperado (la pantalla muestra la columna «Expreso preferido»), pero hay que avisarlo y decidir si el buscador sigue buscando por expreso o si el expreso queda fuera del filtro y solo se muestra en la columna.
- **Migraciones aditivas o con reversión escrita**: ningún PR de este lote debe destruir una tabla o una columna; el traslado y la reconstrucción de funciones necesitan su reversión en el encabezado (como las migraciones de la épica MSF-180) y una migración posterior que deshaga.
- **Documentación obligatoria**: el mismo cambio tiene que actualizar `docs/`, `specs/` y la DER (el cierre de MSF-505 cambia el modelo de datos y su sección `## Modelo de datos (DER)`).

## Open Questions

- [NEEDS CLARIFICATION: el plan del Lote L22 no está en el repo; el alcance exacto de cada uno de los cuatro puntos (y si el plan pedía además, por ejemplo, paginación por keyset en la búsqueda) hay que confirmarlo con quien armó el plan.]
- [NEEDS CLARIFICATION: el predicado de búsqueda con `expreso_preferido` ¿es intencional? Si el expreso no debe ser buscable, el arreglo es al revés (sacar el expreso de la búsqueda y dejar el índice como está); si sí, el índice se reconstruye como en (a).]
- [NEEDS CLARIFICATION: para el evento de auditoría, ¿el tipo es `cliente.exportado` o se reutiliza `actividad.exportada` como en la exportación del historial? Y ¿hace falta el id por corrida de `private.exportaciones_clientes_actividad` o alcanza la constancia en la primera tanda?]
- [NEEDS CLARIFICATION: el traslado de `public.clientes_empresas` y `public.cuentas_cliente` ¿entra en este lote o queda para otro?]
