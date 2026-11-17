# Bug Assessment: Retención y supresión de consultas, ítems de pedido y presupuestos de la tienda (MSF-944)

- **Slug**: msf-944
- **Created**: 2026-11-14
- **Source**: pasted text (tracker MSF-944, tipo «It's a Plan») — **sin URL** en el reporte, no hay nada que fetchear ni política de URL que aplicar
- **Verdict**: valid
- **Severity**: medium

> Nota de encuadre: el ítem es un **seguimiento** (deuda trazada) de la revisión de seguridad de la épica MSF-176, no una regresión. El comportamiento descrito es el **actual y el documentado** (decisión D-20 de la spec `20270306-100000-tienda-compra-y-cuentas`): «sin purga automática en esta épica… con una tarea de seguimiento trazada». El gap es real y está grounded en el código; lo que hay que hacer es **construir la capacidad que falta** (plazo de retención + purga + supresión), no revertir un comportamiento roto. Por eso el veredicto es `valid` (no `invalid`: no es un uso indebido ni un duplicado) y la severidad es `medium` (no `critical`: no hay fuga por RLS, corrupción ni caída; sí hay deuda de protección de datos que crece con cada envío y que hay que cerrar antes de encender `tienda_pedidos` fuera de dev).

## Report (verbatim)

> Seguimiento MSF-176 · Retención y supresión de consultas, ítems y presupuestos de la tienda (It's a Plan MSF-944) slug=msf-944

Contexto del tracker recuperado del repo (no inventado: sale de la propia épica y de sus docs):

- `specs/20270306-100000-tienda-compra-y-cuentas/spec.md:431` — **D-20**: «Retención de las consultas con datos personales: **sin purga automática en esta épica**. No se inventa un plazo legal: queda documentado en `docs/consultas.md` y `docs/tienda-compra-y-cuentas.md` (qué se guarda, quién lo ve, que no se borra solo y cómo borrar a mano una consulta o un cliente) y con una tarea de **seguimiento** trazada («definir plazo de retención y purga de consultas y ítems de pedido»). La IP nunca se guarda y el envío se poda a 24 h (existente)».
- `specs/20270306-100000-tienda-compra-y-cuentas/tasks.md:115` (T063) y `:128` (T072) — seguimientos trazados; **MSF-944** es la clave de ese seguimiento.
- `docs/tienda-compra-y-cuentas.md:410` — **I-5 (retención y supresión)**: «las consultas, los ítems de pedido, los presupuestos de la tienda y sus notas **no se purgan solos** y no hay supresión por titular automática: **MSF-944**. Mientras tanto se borra a mano».
- `docs/seguridad-tienda-compra-y-cuentas.md:36` — lista de seguimientos: MSF-940, MSF-941, MSF-942, MSF-943 y **MSF-944 (retención y supresión de consultas, ítems de pedido y presupuestos de la tienda)**.
- `docs/consultas.md:83` — «**Seguimiento trazado**: definir el plazo de retención y la purga de consultas e ítems de pedido y la supresión a pedido del titular (**MSF-944**, que también cubre los presupuestos de la tienda y sus notas)».

## Symptom

Las consultas que llegan desde la tienda (orígenes `formulario`, `whatsapp` y `pedido`), sus ítems de pedido y los presupuestos creados desde la tienda (con su nota) **se acumulan para siempre**: no hay plazo de retención, no hay purga automática y no hay ninguna vía en la aplicación para la **supresión a pedido del titular**. La única forma de borrarlos hoy es un `delete` manual por SQL hecho por alguien con acceso administrativo a la base; el manual de usuario lo dice así (`docs/producto/consultas.md:104`: «Los pedidos **no se borran solos**… Si tenés que borrar uno, pedíselo al equipo técnico»).

Lo esperado (según el propio seguimiento): un plazo de retención definido, una purga automática que respete ese plazo, y una supresión a pedido del titular que cubra consultas, ítems de pedido, presupuestos de la tienda y sus notas.

## Reproduction

Reproducción por inspección del código y de las docs (no se modificó ninguna base ni dato en este assessment):

1. Una consulta de la tienda se crea desde `publico.crear_consulta_publica` (`supabase/migrations/20261205100100_crear_consulta_publica.sql:74`) o desde `private.crear_consulta_pedido` (`supabase/migrations/20270321100400_enviar_lista_pedido.sql:71`): el `insert into dominio.consultas` **no setea `contacto_id`** → la consulta de la tienda no queda vinculada a `dominio.contactos`.
2. Sobre `dominio.consultas` no hay ninguna política de borrado ni de purga: la única política es `consultas_select` (`supabase/migrations/20261205100000_consultas.sql:92`) y el permiso es `grant select` (`:103`) — «nadie inserta, edita ni borra directo».
3. No existe ninguna función de retención/purga para `dominio.consultas`, `dominio.consulta_items` o `dominio.presupuestos_tienda`: las únicas purgas de la base son `private.purgar_api_llamadas` (auditoría de la API, 90 días) y `private.depurar_registro_actividad` (24 meses); ninguna toca consultas. En el repo **no hay `pg_cron`** (los purgadores son flows de Kestra).
4. Los ítems de pedido quedan atados a su consulta por FK `on delete cascade` (`supabase/migrations/20270321100000_consulta_items.sql:86-88`): viven exactamente lo que viva la consulta, es decir, para siempre. El comentario de la tabla lo dice: «Datos personales por vía de la consulta: **sin purga automática (D-20)**» (`:103`).
5. Los presupuestos de la tienda tampoco tienen camino de borrado: `dominio.presupuestos_tienda` (`supabase/migrations/20270322100100_presupuestos_tienda.sql:28`) solo tiene `select` para `authenticated` (`:71`, `:80`); el presupuesto en sí es un `dominio.comprobantes_venta` (fiscal: se anula, no se borra) y la nota libre de la persona (`nota`, `:36`) queda pegada a ese comprobante.
6. La **supresión** existente (`public.anonimizar_contacto`, `supabase/migrations/20270201100500_anonimizar_contacto.sql`) solo alcanza a las consultas **vinculadas por `contacto_id`** (`:50-56`), es decir, las que alguien cargó a mano en la libreta de contactos: una consulta de tienda nunca entra por ese camino. Y `anonimizar_contacto` no toca `dominio.comprobantes_venta` (lo declara en su encabezado), o sea que tampoco cubre los presupuestos de la tienda ni sus notas.
7. Al borrar un cliente, sus consultas **no se borran**: `dominio.consultas.cliente_id` queda en `null` (`on delete set null`, `supabase/migrations/20270321100000_consulta_items.sql:53-55`) y el nombre y el contacto de la consulta siguen («Si se borra un cliente, sus pedidos **no se borran**… hay que borrarlos aparte», `docs/consultas.md:79`).
8. Efecto colateral no documentado: el aviso de «consulta nueva» se emite a la cola `public.avisos_pendientes` con el **Nombre, el Contacto y el Mensaje** del visitante en `datos` (`supabase/migrations/20261210130300_consultas_aviso_emitir.sql:172-183`). Esa cola **no tiene FK a `dominio.consultas`** (`supabase/migrations/20261210120300_avisos_cola.sql:11-31`) y **nadie la borra** en producción (las únicas apariciones de `delete from public.avisos_pendientes` están en tests y E2E). O sea: **purgar `dominio.consultas` no alcanza para que los datos personales desaparezcan** — quedan en la cola de avisos.

## Suspected Code Paths

- `supabase/migrations/20261205100000_consultas.sql:22-103` — tabla `dominio.consultas` (datos personales: `nombre` `:27`, `contacto` `:28`, `mensaje` `:29`, `nota_interna` `:33`), RLS solo de lectura (`:92`, `:102-103`): sin purga y sin borrado desde la app.
- `supabase/migrations/20270321100000_consulta_items.sql:68` (tabla), `:86-88` (FK `on delete cascade` a la consulta), `:103` (comentario «sin purga automática (D-20)») — los ítems de pedido se van con la consulta, y la consulta no se va nunca.
- `supabase/migrations/20270322100100_presupuestos_tienda.sql:28` (tabla), `:36` (`nota`), `:44` (FK al comprobante, sin `ON DELETE`), `:50` (FK a `public.clientes`, **sin `ON DELETE` → `NO ACTION`**), `:54` (FK a la cuenta, `on delete cascade`), `:71`/`:80` (solo `select`) — presupuestos y notas sin purga ni supresión.
- `supabase/migrations/20261205100100_crear_consulta_publica.sql:74` y `supabase/migrations/20270321100400_enviar_lista_pedido.sql:71` — el alta de la tienda **no** setea `contacto_id`: por diseño las consultas de tienda quedan fuera del alcance de la anonimización de contactos.
- `supabase/migrations/20270201100500_anonimizar_contacto.sql:19-67` — el único mecanismo de supresión que existe; `:50-56` solo toca `where contacto_id = p_id`; el encabezado aclara que **no** toca `dominio.comprobantes_venta`.
- `supabase/migrations/20261210130300_consultas_aviso_emitir.sql:172-183` — el payload de `consulta_nueva` (`Nombre`, `Contacto`, `Mensaje`) que queda en `public.avisos_pendientes.datos` (tabla en `supabase/migrations/20261210120300_avisos_cola.sql:11-31`, sin FK a consultas y sin purga en producción).
- Precedentes de purga por retención reutilizables: `supabase/migrations/20261212120700_tienda_contacto.sql:129` (poda de `dominio.tienda_envios` > 24 h dentro de la propia RPC de escritura, sin worker ni cron), `supabase/migrations/20270207100002_depurar_registro_actividad.sql:33` (`private.depurar_registro_actividad` + `grant` al rol de orquestación), `supabase/migrations/20270301100000_api_decisiones_abiertas_msf233.sql:392` (`private.purgar_api_llamadas(p_retencion_dias)` con retención de 90 días) y los flows `infra/kestra/flows/purgar-api-llamadas.yml` / `infra/kestra/flows/depuracion-actividad.yml` (cron diario, rol `kestra_orquestacion`).
- Docs que hoy describen el comportamiento (hay que actualizarlas cuando se cierre): `docs/consultas.md:73-83`, `docs/tienda-compra-y-cuentas.md:410`, `docs/seguridad-tienda-compra-y-cuentas.md:36`, `docs/producto/consultas.md:104`, `docs/tiendas-online.md:1283-1289`.

## Root Cause Hypothesis

Confianza: **alta**. No es un defecto de implementación sino una **decisión de producto explícita** (D-20: «no se inventa un plazo legal») que quedó con un seguimiento trazado, más **tres ausencias técnicas concretas** que hacen que el seguimiento sea cierto hoy:

1. **No hay motor de retención** para `dominio.consultas` / `dominio.consulta_items` / `dominio.presupuestos_tienda`: ninguna función `private.purgar_*` las toca, ningún flow de Kestra las despacha y no hay `pg_cron` en el repo. La única poda automática de datos de visitantes es la de `dominio.tienda_envios` (24 h), que es de cupo, no de retención.
2. **No hay camino de supresión** para lo que la tienda realmente produce: las consultas de tienda nacen sin `contacto_id`, así que `public.anonimizar_contacto` no las alcanza; los presupuestos de la tienda cuelgan de un comprobante fiscal que no se borra y tienen `nota` y FKs `NOT NULL` a cliente y cuenta web; y la copia de los datos personales en la cola `public.avisos_pendientes` no tiene ni FK ni purga.
3. **La baja del cliente no es una supresión**: `dominio.consultas.cliente_id` queda en `null` y el nombre y el contacto sobreviven; y `dominio.presupuestos_tienda` bloquea el borrado del cliente por FK (`NO ACTION`), con lo que el borrado manual del cliente tampoco resuelve los presupuestos.

El resultado es que los datos personales de los visitantes de la tienda (nombre, contacto, mensaje, nota) y las notas de los presupuestos se conservan indefinidamente, sin que exista una decisión de plazo ni una herramienta para acatarla.

## Proposed Remediation

> El plazo legal de retención **no lo puede fijar esta sesión**: es un requisito de negocio/legal. Por la regla de `AGENTS.md` («No inventes requisitos de negocio: conviértelos primero en una spec»), el primer paso es una spec nueva (no un fix improvisado sobre el código). El shape que sigue es el que la evidencia del repo sugiere.

**Preferred**:

1. **Spec primero** (`specs/<fecha>-retencion-y-supresion-consultas-tienda/`): decidir (a) el plazo de retención por tipo de dato (consultas resueltas vs. en curso, ítems, presupuestos pendientes vs. aceptados, notas), (b) si la supresión es por consulta, por titular (contacto + cuenta web) o por pedido, (c) qué se anonimiza y qué se borra, y (d) el comportamiento con `dominio.comprobantes_venta` (registro fiscal: no se borra). Con `## Modelo de datos (DER)` y `pnpm der:check`.
2. **Migración aditiva de base** (con su camino de reversión documentado, sin destruir nada en el mismo PR):
   - `private.purgar_consultas_tienda(p_retencion_dias integer)` — `security definer`, `set search_path = ''`, `revoke` a `public/anon/authenticated` y `grant execute` a `kestra_orquestacion`, siguiendo el patrón de `private.purgar_api_llamadas` y `private.depurar_registro_actividad`. Borra las consultas que superen el plazo **según el criterio que fije la spec** (con el estado de la consulta como condición, para no perder compromisos comerciales abiertos) y deja que las FKs `on delete cascade` lleven los ítems (`consulta_items`) y los avisos legacy (`consultas_avisos`). Idempotente.
   - Una función de **supresión a pedido del titular** para lo que hoy no tiene camino: algo del estilo de `public.suprimir_consulta(p_consulta_id, p_updated_at)` (patrón `anonimizar_contacto`: `consultas` = edición + empresa accesible, `40001` por sello `updated_at`, `42501` sin permiso, `22023` si ya se suprimió) que deje `nombre`, `contacto`, `mensaje` y `nota_interna` en valor neutro y marque la supresión; y, para los presupuestos de la tienda, suprimir la `nota` y desvincular cliente/cuenta (esto obliga a revisar los `NOT NULL` y las FKs de `dominio.presupuestos_tienda` → alternativa: columna `anonimizado_en` y columnas del vínculo nulificables).
   - **Limpiar la copia de la cola**: la purga tiene que alcanzar `public.avisos_pendientes` (filas `pendiente`/`fallido` de tipo `consulta_nueva`, cuyo `datos` lleva Nombre, Contacto y Mensaje) o, mejor, dejar de persistir el payload personal en la cola (guardar solo el id de la consulta y componer el texto al enviar). Hoy la cola no tiene FK ni purga: es el punto que más fácil se escapa de una solución que solo toque `dominio.consultas`.
3. **Flow de Kestra** `infra/kestra/flows/purgar-consultas-tienda.yml` (copia de `purgar-api-llamadas.yml`: cron diario, rol `kestra_orquestacion`, `EXECUTE` solo sobre la función, subtask de aviso de fallo `aviso-fallo-api` o el que corresponda) + la variable de retención en `infra/kestra/.env.example`.
4. **Docs**: actualizar `docs/consultas.md` (§ «Retención de los pedidos»), `docs/tienda-compra-y-cuentas.md` (I-5), `docs/seguridad-tienda-compra-y-cuentas.md` (seguimientos), `docs/producto/consultas.md`, `docs/tiendas-online.md` y `docs/ventas-comprobantes.md`; dejar de decir «no se borran solos» solo cuando la capacidad exista. `pnpm docs:check` en verde.
5. **UI (solo si la spec la pide)**: un botón de supresión en el detalle de la consulta (y el de los presupuestos) con su diálogo, su E2E y su fila en `## Matriz pantalla↔criterios` («Empresa activa» incluida), siguiendo `FiltroEmpresa`/`SelectorEmpresas` y el patrón de `AnonimizarContactoDialog` (`apps/web/src/pages/contactos/AnonimizarContactoDialog.tsx`).

**Alternatives**:

- **Solo anonimizar, no borrar** (reemplazar nombre/contacto/mensaje/nota en vez de eliminar la fila): conserva la traza comercial y la auditoría, pero deja filas infinitas y no cumple un «derecho de supresión» estricto; sirve como etapa intermedia.
- **Borrado duro de la consulta** (en vez de anonimizar): más simple y barato, pero pierde el histórico y el rastro de `registro_actividad` queda huérfano; choca con la decisión vigente de que las consultas se resuelven/anulan, no se borran.
- **Configuración del plazo por organización** (tabla de configuración + pantalla) en vez de una variable de entorno: más operativo (cada organización con su plazo, p. ej. por actividad económica), a costa de una pantalla, permisos y validación de rangos.
- **No hacer nada en la app y dejar el procedimiento manual en SQL** (el estado actual): no cierra el seguimiento; sirve solo como puente mientras la spec se define.

**Files likely to change**:

- `specs/<nueva-spec>/{spec.md,plan.md,tasks.md,contracts/…}` (nueva; obligatoria antes del código)
- `supabase/migrations/<n>_retencion_consultas_tienda.sql` (nueva; `private.purgar_consultas_tienda` + supresión + grants + `comment on`)
- `supabase/migrations/<n+1>_…` (si la purga de la cola o las columnas de `dominio.presupuestos_tienda` cambian el esquema)
- `infra/kestra/flows/purgar-consultas-tienda.yml` (nueva) e `infra/kestra/.env.example`
- `supabase/tests/database/consultas_retencion.test.sql` (nueva)
- `docs/consultas.md`, `docs/tienda-compra-y-cuentas.md`, `docs/seguridad-tienda-compra-y-cuentas.md`, `docs/producto/consultas.md`, `docs/tiendas-online.md`, `docs/ventas-comprobantes.md`
- `apps/web/src/lib/consultas.ts` + `apps/web/src/pages/consultas/*` y `apps/web/src/pages/ventas/presupuestos.tsx` (solo si hay pantalla de supresión)

**Tests to add or update**:

- pgTAP `supabase/tests/database/consultas_retencion.test.sql`: la purga borra solo lo que superó el plazo y según el estado acordado; es idempotente (segunda pasada no borra nada); los ítems (`consulta_items`) y los avisos legacy (`consultas_avisos`) se van en cascada; **no** toca `dominio.comprobantes_venta` ni `dominio.presupuestos_tienda` de otros métodos; una organización no borra datos de otra; `kestra_orquestacion` puede ejecutarla y `authenticated`/`anon` no (`42501`); el rango de días inválido se rechaza.
- pgTAP de supresión: permiso (`42501`), empresa no accesible (`42501`), conflicto de concurrencia (`40001`), ya suprimida (`22023`), que deja `nombre`/`contacto`/`mensaje`/`nota_interna` neutros y la `nota` del presupuesto sin datos, que **no** borra el comprobante fiscal y que no copia datos personales al registro de actividad.
- pgTAP de la cola: tras purgar, `public.avisos_pendientes` no conserva el Nombre/Contacto/Mensaje de las consultas purgadas (o la cola deja de guardarlos).
- Test del flow de Kestra con el patrón de `infra/kestra/flows/purgar-api-llamadas.test.mjs`.
- Vitest + E2E (Playwright) **solo** si la spec agrega la pantalla de supresión (patrón `apps/web/e2e/tienda-lista-pedido.e2e.ts` para el alcance de la tienda).
- `pnpm lint`, `pnpm build`, `pnpm der:check`, `pnpm docs:check` y `pnpm test` (con `pnpm dev:supabase` para lo de base).

## Risks & Considerations

- **Borrado irreversible**: la purga borra datos de clientes sin vuelta (solo un backup). Exportar antes (el exportador total ya incluye `dominio.consultas`, `dominio.consulta_items` y `dominio.presupuestos_tienda`: `supabase/migrations/20270321100500_exportacion_total_consulta_items.sql`, `supabase/migrations/20270322100200_exportacion_total_presupuestos_tienda.sql`) y decidir si el exportador total debe seguir listando tablas que ya se purgan (el pgTAP de completitud `exportacion_total.test.sql` puede pedirlo).
- **Copias que la purga no alcanza**: backups de Postgres, los archivos de exportación y **la cola `public.avisos_pendientes`** (que hoy es la copia huérfana de nombre/contacto/mensaje). Sin eso, la promesa de «se borró» es falsa.
- **No perder compromisos abiertos**: purgar por antigüedad a secas puede borrar consultas «en curso» con un pedido en negociación o presupuestos «pendientes» que el equipo todavía tiene que responder. El criterio (estado + plazo) tiene que venir de la spec.
- **El registro fiscal no se toca**: el presupuesto es un `dominio.comprobantes_venta` y sus importes, estados y fechas son intocables (misma línea que `anonimizar_contacto`). La supresión del presupuesto tiene que actuar sobre `dominio.presupuestos_tienda` (nota y vínculos), no sobre el comprobante.
- **Cambio de esquema inevitable**: `dominio.presupuestos_tienda` tiene `cliente_id` y `cuenta_cliente_id` `NOT NULL` con FK `NO ACTION` a `public.clientes`; para poder desvincular hay que hacerlos nulificables o agregar `anonimizado_en`. Eso es migración aditiva + su camino de reversión, y hay que revisar que no rompa el listado de presupuestos de origen tienda (`20270322100500_listar_presupuestos_origen_tienda.sql`).
- **Permisos y superficie**: la función de purga no puede ser ejecutable por la API (`anon`/`authenticated`), y la de supresión exige `consultas` = edición + empresa accesible, como `anonimizar_contacto`; el rol `kestra_orquestacion` es el único que corre las purgas.
- **Multi-tenant**: la purga corre global o por organización; tiene que garantizar que no toca datos de otra organización (mismo criterio de `private.depurar_registro_actividad`).
- **Coherencia con otros seguimientos abiertos**: MSF-943 (validez por defecto del presupuesto) y la decisión I-4 (10 presupuestos abiertos sin vencimiento automático) conviven con esto; el criterio de purga no debería contradecirlos.
- **Flag de despliegue**: `tienda_pedidos` está apagada por defecto y solo habilitada en dev; la guía ya marca que MSF-945 se aplica antes de encenderla fuera de dev. **MSF-944 debería tener la misma barra** antes de encender la bandera en staging/producción (si no, se multiplica la deuda de datos personales en un entorno real).
- **Convención del repo**: todo cambio de plataforma/worker/Kestra/Supabase debe ir con su doc y su prueba (`pnpm docs:check`); la migración debe ser aditiva y con reversión documentada en la spec.

## Open Questions

- [NEEDS CLARIFICATION: ¿cuál es el plazo de retención por tipo de dato (consultas resueltas, en curso y nuevas; ítems de pedido; presupuestos pendientes, aceptados y anulados; notas)? Es el insumo que D-20 dejó abierto y no lo puede fijar la ingeniería sin una decisión de negocio/legal.]
- [NEEDS CLARIFICATION: ¿la supresión es por consulta/presupuesto, por titular (contacto de la libreta + cuenta web + cliente) o por producto? Si es por titular, hay que definir si también se anonimiza `dominio.contactos` y `public.cuentas_cliente` y qué pasa con `dominio.comprobantes_venta` (fiscal, no se borra).]
- [NEEDS CLARIFICATION: ¿la purga debe ser global (todas las organizaciones) o por organización con un plazo configurable por organización? Hoy laretención de la API es un parámetro del flow (`API_AUDITORIA_RETENCION_DIAS`).]
- [NEEDS CLARIFICATION: ¿el equipo quiere la supresión como pantalla del panel (Consultas/Presupuestos) o como procedimiento documentado para el equipo técnico, como el de hoy? Define si la solución necesita UI (y con ella prototipo, matriz pantalla↔criterios y E2E).]
- [NEEDS CLARIFICATION: ¿la cola `public.avisos_pendientes` puede dejar de guardar el payload personal (`Nombre`, `Contacto`, `Mensaje`) o hay que purgarla con su propia política? Es la copia que hoy sobrevive a cualquier borrado de `dominio.consultas`.]
