# Bug Fix: MSF-988 — cierre de los hallazgos H-2 a H-6 de MSF-176 sobre `dokploy` actual

- **Slug**: msf-988
- **Fixed**: 2026-11-17
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se rehízo el fix de seguridad del PR #965 (que quedó `CONFLICTING` desde el 2026-11-14) sobre `origin/dokploy` actual: las cuatro
migraciones del cierre se renumeraron (`20270507200101` a `20270507200104`) y sus cuerpos se reconstruyeron sobre las definiciones
vigentes de la base (no sobre las del 2026-11-14, que revertían cambios ya mergeados). H-4 no necesitó migración: ya estaba corregido
en `dokploy` por `20270430000000_tienda_menores_revision.sql`, y su prueba se conserva adaptada.

Sobre ese commit el CI (`application`, `database` y `validacion`) signalizó cuatro puntos, corregidos en un commit nuevo: las versiones
de las migraciones quedaron `REUSADA` (por debajo del máximo de `dokploy`), el fixture del pgTAP del cierre moría con «duplicate key …
`existencias_pkey`», la ráfaga de 203 favoritos del pgTAP vigente chocaba con el cupo nuevo y el comentario de
`mis_compras_por_dominio` perdía el «DEFENSA EN PROFUNDIDAD» que fija `tienda_menores_revision.test.sql`.

**Devolución del Revisor (PR #1128, 2026-11-17):** el Revisor pidió ocho cambios y este commit los atiende (el detalle, hallazgo por
hallazgo, está en `assessment.md`): las migraciones quedan por encima del máximo real de la base (`20270507180800` en `dokploy` al
verificar y `20270507200100` en la rama de la épica), en `20270507200101`–`20270507200104`; la evidencia de
este archivo y de `test.md` se corrige (decía un estado que no existía); la fusión repunta también `cuenta_cliente_id` (para que los
presupuestos del cliente al que se da de baja la cuenta no queden sin cuenta y el cliente fusionado no pueda gastar el tope dos
veces) y re-apunta las consultas sin hacer avanzar su `updated_at`; el cupo de llamadas llega a la pantalla con su texto y sus
segundos (no como una caída de red); un Vitest nuevo compara carácter por carácter el conjunto de caracteres bloqueados del SQL con
el del front; y el contrato, la guía de seguridad y la guía funcional dicen lo que corresponde (las cinco RPC cambian de volatility, y
el camino de reversión de la migración del vínculo es el completo).

La rama quedó **rebasada sobre `origin/dokploy` al día** (`e26696ba7`, el PR #1130 integrado): los 22 commits que avanzó la base no
tocan ninguno de los archivos de esta historia, así que el rebase fue sin conflictos. El máximo real de las migraciones de `dokploy`
avanzó después a `20270507180800` (lotes posteriores a #1124), así que las cuatro del cierre quedan en `20270507200101` a
`20270507200104`: por encima de ese máximo (para que el guard no las marque `REUSADA` y el aplicador no se salte las que ya están
aplicadas) y por encima también de `20270507200100`, la última migración de la rama de la épica
`epic/MSF-515-lote-35-menores-de-revision` (para que la integración de esta historia en la épica no choque con esa versión).

**Devolución del Revisor (PR #1128, 2026-11-18):** los cinco hallazgos de esta devolución se atienden en un commit nuevo:
(a) la 5ª RPC con cupo (`mi_compra_por_dominio`) también distingue el `limite` de una caída de red en `DetalleCompra`; (b) el
re-apuntado de `cuenta_cliente_id` ya no aborta con «duplicate key» si las dos cuentas comparten `clave_envio` (se deja sin cuenta el
que choca y la fusión sigue, con su pgTAP); (c) las referencias a las cuatro migraciones en `docs/` y en la evidencia de la historia
dicen los nombres reales (`20270507200101`–`20270507200104`) y el máximo real verificado; (d) el DER de la spec declara
`dominio.clientes` (la tabla se movió en `20270418000401`), que es el esquema al que apunta la FK del cierre; y (e) el botón «Cargar
más» de la carga infinita ya no queda muerto cuando el clic llega antes de que React vacíe los efectos pasivos (causa de la caída del
job `web (2)`), con su test de regresión.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270507200101_presupuestos_tienda_vinculo_persistente.sql` | added | H-2 (parte 1): `cuenta_cliente_id` admite nulo y su FK pasa a `on delete set null (cuenta_cliente_id)`; las FK de cliente y comprobante pasan a `on delete cascade` (si no, la baja de la organización se bloqueaba). Referencia a `dominio.clientes` (la base movió la tabla en MSF-882). |
| `supabase/migrations/20270507200102_fusionar_clientes_repunta_tienda.sql` | added | H-2 (parte 2): `public.fusionar_clientes` repunta `dominio.presupuestos_tienda.cliente_id` y `dominio.consultas.cliente_id` al cliente conservado. Cuerpo = el vigente (`20270419000200`, con el bloque de opiniones de MSF-467 y `dominio.clientes`) más ese cambio. |
| `supabase/migrations/20270507200103_tienda_cupo_llamadas_cuenta.sql` | added | H-3: `private.limite_llamadas_cuenta_por_minuto()` (120) y cupo por cuenta en las cinco RPC de «Mi cuenta», tomado después de resolver la cuenta y antes de cualquier lectura, en un bloque anidado con su manejador (sobrevive a un error). Las cuatro que eran `stable` pasan a `volatile`. Cuerpos = los vigentes. |
| `supabase/migrations/20270507200104_tienda_caracteres_invisibles.sql` | added | H-6: conjunto de caracteres bloqueados ampliado (U+00AD, U+180E, U+2061 a U+2064) en `enviar_lista_pedido` y `crear_presupuesto_tienda`. Cuerpos = los vigentes (idénticos carácter a carácter salvo las dos constantes). |
| `supabase/tests/database/tienda_cierre_hallazgos.test.sql` | added test | 64 aserciones: H-2 (baja de cuenta, fusión en los dos casos del diálogo y baja de organización), H-3 (cupo por cuenta en las cinco RPC, que sobrevive a un error), H-4 (el cupo de la lista y del envío sobrevive a una excepción) y H-6 (caracteres invisibles en B1 y B2). Adaptado a la base (`dominio.clientes`, firma de `precio_referencia_pedido`, `listar_presupuestos` con seis parámetros, cupo de 10 por minuto del presupuesto). |
| `supabase/tests/database/tienda_cierre_hallazgos.test.sql` | fixed | El fixture subía `dominio.existencias.cantidad` con un `insert` que chocaba con la fila que ya deja el trigger `productos_crear_existencias`: ahora `on conflict (producto_id) do update`. |
| `supabase/tests/database/tienda_favoritos.test.sql` | fixed | La ráfaga de 203 favoritos (una sola transacción) chocaba con el cupo nuevo de 120 llamadas por minuto: el test sube el cupo **dentro de su transacción** (se deshace al final), igual que en el PR #965. El cupo real se prueba en `tienda_cierre_hallazgos.test.sql`. |
| `supabase/migrations/20270507200103_tienda_cupo_llamadas_cuenta.sql` | fixed | Los comentarios de las cinco RPC se reproducen los de la base (con su documentación completa, incluida la «DEFENSA EN PROFUNDIDAD» que fija un pgTAP de catálogo) y suman la nota del cupo: un `create or replace` borra el comentario anterior. |
| `supabase/migrations/20270507200104_tienda_caracteres_invisibles.sql` | fixed | Ídem: los comentarios de `enviar_lista_pedido` y `crear_presupuesto_tienda` reproducen los de la base y suman la nota de los caracteres nuevos. |
| `supabase/migrations/20270507200102_fusionar_clientes_repunta_tienda.sql` | modified (Devolución del Revisor, 2026-11-18) | El re-apuntado no choca con `presupuestos_tienda_clave_uq`: si la cuenta que sobrevive ya tiene un presupuesto con la misma `clave_envio`, ese vínculo NO se re-apunta y queda sin cuenta al darse de baja la suya (la fusión sigue, no aborta con «duplicate key»). pgTAP nuevo: dos cuentas de la misma empresa con la misma clave (la poda de 24 h la libera) y la fusión no falla. |
| `supabase/migrations/20270507200102_fusionar_clientes_repunta_tienda.sql` | modified (Devolución del Revisor, 2026-11-17) | Antes de dar de baja la cuenta web que no se elige, los presupuestos de ese cliente pasan a la cuenta que **sobrevive** de la misma empresa (si no, sus vínculos quedarían sin cuenta, fuera del conteo de los topes por cuenta —5 por día y 10 abiertos— y de la idempotencia `(cuenta, clave)`, y el cliente fusionado podría gastar el tope dos veces). El re-apuntado de `dominio.consultas` desactiva el trigger `consultas_normalizar` solo para ese `update` (es DDL transaccional): es un traslado de datos, no una edición, así que la consulta no aparece como modificada ahora. |
| `apps/web/src/lib/tiendaCuentaDatos.ts` | modified | `limite` (H-3) es un error propio con reintento y su espera en segundos; no se confunde con «cuenta no está activa». |
| `apps/web/src/lib/tiendaCuentaDatos.ts` | modified (Devolución del Revisor) | El texto del cupo lleva los segundos que pidió el servidor (`mensajeLimite`) y `esLimite` distingue el cupo de una caída de red: sin esto, el texto y la espera eran código muerto (probados en la lib, mostrados en ningún lado). |
| `apps/web/src/lib/tiendaCuentaDatos.test.ts` | added test | El `limite` del servidor en las cinco RPC → `ErrorCuentaTienda` con código `limite`, espera y texto propios (con los segundos en el mensaje) y `esLimite` que lo distingue de un error de red. |
| `apps/web/src/hooks/useListadoPorCursor.ts` | modified (Devolución del Revisor) | Expone `espera` (el aviso del cupo con los segundos, el patrón compartido de `CargaInfinita`): el cupo no se muestra como el error genérico ni se registra como error de consola. La copia del estado vigente a un ref pasa a `useLayoutEffect`: con un `useEffect` pasivo, un clic en «Cargar más» que llega antes de que React vacíe los efectos leía un ref viejo y el botón no hacía nada (la caída de `web (2)`). |
| `apps/web/src/pages/tienda-publica/cuenta/DetalleCompra.tsx` | modified (Devolución del Revisor) | `mi_compra_por_dominio` es la 5ª RPC con cupo: el `catch` distingue el `limite` con `esLimite` y el error con reintento muestra el texto del cupo y los segundos, no el genérico «No pudimos cargar el comprobante.». |
| `apps/web/src/hooks/useFavoritosEntre.ts` | modified (Devolución del Revisor) | Avisa el cupo por `alLimite` (con su texto y su espera) en vez de tratarlo como una caída de red. |
| `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.tsx`, `FavoritosMiCuenta.tsx`, `HistorialMiCuenta.tsx` | modified (Devolución del Revisor) | El cupo de llamadas llega a la pantalla: la ficha y la lista de favoritos avisan el texto del cupo, y el historial y los favoritos lo muestran en el error con reintento y en el pie de carga infinita (con la espera). |
| `apps/web/src/lib/tiendaPedido.ts` | modified | Conjunto de caracteres bloqueados del front ampliado con el mismo de SQL (U+00AD, U+180E, U+2061 a U+2064). |
| `apps/web/src/lib/tiendaPedido.test.ts` | modified | El caso de los invisibles cubre el conjunto nuevo. |
| `apps/web/src/lib/tiendaPedido.caracteres.test.ts` | added test (Devolución del Revisor) | Compara **carácter por carácter** el conjunto bloqueado del SQL con el del front sobre todo el BMP (y exige que las dos funciones del servidor usen el mismo): si uno de los dos queda viejo, el test falla diciendo qué carácter difiere. |
| `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx` | added test | El límite de llamadas avisa el error con reintento y **no** dice «cuenta no está activa». |
| `apps/web/src/hooks/useListadoPorCursor.test.tsx`, `useFavoritosEntre.test.tsx`, `cuenta/MiCuentaPantallas.test.tsx` | modified test (Devolución del Revisor) | El cupo de llamadas llega a la pantalla con su texto y sus segundos (primera tanda, tanda siguiente, lectura de favoritos, ficha y lista de favoritos). |
| `scripts/medir-tienda-favoritos.sql` | modified | H-6: el script se niega a correr sin `-v BASE_DESCARTABLE=si` y en bases con más de 5 organizaciones. |
| `docs/seguridad-tienda-compra-y-cuentas.md` | modified | Registra la revisión integral (T070) con los hallazgos H-1 a H-6, la resolución de cada uno y las notas de H-5 y del `statement_timeout`. |
| `docs/tienda-compra-y-cuentas.md` | modified | Sección de cierre: qué cambia para quien opera o desarrolla, migraciones del cierre (con el camino de reversión completo) y pruebas. |
| `docs/clientes.md` | modified (Devolución del Revisor) | Qué pasa con los presupuestos y las consultas de la tienda al fusionar clientes (y que las consultas re-apuntadas no cambian su `updated_at`). |
| `specs/20270306-100000-tienda-compra-y-cuentas/spec.md` | modified | DER: `cuenta_cliente_id` nullable con `on delete set null`. Además el grafo y la tabla de `dominio.consultas` declaran `dominio.clientes` (no `public.clientes`): la tabla se movió en `20270418000401` y es el esquema al que apunta la FK del cierre. |
| `specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md` | modified | Contrato del cierre: cupo por cuenta en las cinco RPC de «Mi cuenta» y vínculo persistente. |

## Diff Highlights (optional)

```sql
-- H-2: la baja de la cuenta no se lleva el vínculo del presupuesto
alter table dominio.presupuestos_tienda alter column cuenta_cliente_id drop not null;
alter table dominio.presupuestos_tienda drop constraint if exists presupuestos_tienda_cuenta_fk;
alter table dominio.presupuestos_tienda
  add constraint presupuestos_tienda_cuenta_fk
    foreign key (cuenta_cliente_id, organizacion_id, empresa_id)
    references public.cuentas_cliente (id, organizacion_id, empresa_id) on delete set null (cuenta_cliente_id);
```

```sql
-- H-3: el cupo se toma fuera del bloque con el manejador, así sobrevive a un error
v_cupo := private.registrar_pedido_publico('cuenta|' || v_cuenta.cuenta_cliente_id::text, private.limite_llamadas_cuenta_por_minuto());
if (v_cupo ->> 'limitado')::boolean then
  return jsonb_build_object('estado', 'limite', 'espera_segundos', (v_cupo ->> 'espera_segundos')::integer);
end if;
```

## Tests Added or Updated

- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` — H-2: la cuenta borrada conserva vínculo, nota, cliente y rótulo «Tienda
  online (cliente)»; la fusión repunta presupuestos y consultas al conservado y ningún vínculo queda apuntando al archivado; borrar
  el usuario de Auth conserva el vínculo; la baja de la organización con presupuestos no se bloquea.
- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` — H-2 (Devolución del Revisor): los presupuestos del cliente al que se da de
  baja la cuenta web pasan a la cuenta que sobrevive, en los **dos** casos del diálogo (se conserva la cuenta del conservado y la del
  descartado), la cuenta que sobrevive no arranca en cero (los dos presupuestos cuentan para sus topes) y las consultas re-apuntadas
  conservan su `updated_at`.
- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` — H-3: las cinco RPC son `volatile` y `security definer`, solo para
  `authenticated`; la cuarta llamada del minuto responde `limite` con la espera en segundos; sin cuenta activa la respuesta es
  `sin_acceso` idéntica y no gasta cupo; el cupo se gasta igual aunque la llamada falle por dentro.
- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` — H-4: con el cupo a 3 por minuto y una falla provoked después del cupo,
  las tres primeras llamadas responden `error` genérico y la cuarta responde `limite` (el cupo sobrevivió), para la lista y para el
  envío; no se creó ninguna consulta.
- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` — H-6: `crear_presupuesto_tienda` rechaza en la nota U+00AD, U+180E,
  U+2061 a U+2064 y los anteriores; `enviar_lista_pedido` los rechaza en la nota y en el nombre; un texto normal con tildes, emoji y
  salto de línea sigue siendo válido.
- `apps/web/src/lib/tiendaCuentaDatos.test.ts` — el `limite` del servidor es un `ErrorCuentaTienda` de código `limite` con espera y
  texto propios (con los segundos en el mensaje), y `esSinAcceso` da `false`.
- `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx` — el aviso del límite no dice «cuenta no está activa» y el botón
  sigue disponible.
- `apps/web/src/hooks/useListadoPorCursor.test.tsx` — el cupo de llamadas expone el aviso con la espera (primera tanda y tanda
  siguiente) y un error de red no expone ninguno.
- `apps/web/src/hooks/useFavoritosEntre.test.tsx` — el cupo de llamadas al leer los favoritos avisa su texto y su espera.
- `apps/web/src/pages/tienda-publica/cuenta/MiCuentaPantallas.test.tsx` — el historial y el «Quitar» de un favorito avisan el cupo con
  sus segundos (no como una caída de red).
- `apps/web/src/lib/tiendaPedido.caracteres.test.ts` — el conjunto de caracteres bloqueados del SQL y el del front son el mismo
  (carácter por carácter sobre todo el BMP) y las dos funciones del servidor usan el mismo conjunto.

## Local Verification

- Commands run (sobre el commit con la devolución, rebasado sobre `origin/dokploy`):
  - `pnpm --filter @platform/web lint` → **OK** (código 0; solo avisos preexistentes de `oxlint`, ninguno en los archivos tocados).
  - `pnpm build` (`tsc -b` + `vite build`) → **OK** (`✓ built in 5.34s`).
  - `vitest run src/lib/tiendaCuentaDatos.test.ts src/lib/tiendaPedido.test.ts src/lib/tiendaPedido.caracteres.test.ts
    src/hooks/useListadoPorCursor.test.tsx src/hooks/useFavoritosEntre.test.tsx src/pages/tienda-publica/cuenta/` → **142 pruebas en
    verde** (8 archivos).
  - `vitest run src/lib/tiendaOpiniones.test.ts src/pages/tienda-publica/cuenta/favoritosSoloEnLaTienda.test.ts
    src/pages/tienda-publica/lista/ src/pages/tienda-publica/opiniones/ src/hooks/useComprasCliente.test.tsx
    src/components/consultas/` → **188 pruebas en verde** (12 archivos: los que dependen de `tiendaCuentaDatos`/`tiendaPedido`).
  - `pnpm docs:check` → **OK** («Documentación de cambios: OK (4047 archivos comparados)», «Migraciones OK: 757 archivo(s), 4 nuevo(s)
    contra origin/dokploy», «Trampas conocidas: OK (4 migración(es), 2 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy)»).
  - `node scripts/verificar-migraciones.mjs --base origin/dokploy --estricto` → **OK**, código 0 («Migraciones OK: 757 archivo(s), 4
    nuevo(s) contra origin/dokploy»): las cuatro versiones (`20270507200101`–`20270507200104`) están por encima del máximo real de la
    base (`20270507180800`) y ninguna está REUSADA.
  - `pnpm matriz:check` → **OK** (0 specs nuevas revisadas: esta historia no agrega pantallas).
  - `node scripts/verificar-der.mjs specs/20270306-100000-tienda-compra-y-cuentas/spec.md` → **DER OK**.
  - `pnpm calidad:code` → `oxlint`, `knip`, `jscpd`, `dependency-cruiser` y `syncpack` en **OK**; `gitleaks` **saltado** (necesita
    Docker, sin permisos en este nodo: «permission denied … /var/run/docker.sock»).
- Los tests **vigilan** la regla (FEAT-236): con `menseLimite` mutado para devolver siempre el texto genérico fallan 12 pruebas de 5
  archivos; con `esLimite` mutado para devolver siempre `false` fallan los tests del cupo. Las dos mutaciones se revirtieron.
- Manual checks:
  - Los cuerpos de `enviar_lista_pedido` y `crear_presupuesto_tienda` de `20270507200104` se compararon **carácter a carácter** con
    sus definiciones vigentes (`20270430000000` y `20270507130100`): idénticos salvo las dos constantes de caracteres.
  - Los cuerpos de las cinco RPC de «Mi cuenta» de `20270507200103` se compararon con los vigentes: la única diferencia es el cupo,
    el bloque anidado y `stable` → `volatile`.
  - El cuerpo de `fusionar_clientes` de `20270507200102` es el de `20270419000200` más los `update` que repuntan (y el que pasa los
    presupuestos a la cuenta que sobrevive).
  - Los comentarios de las ocho funciones redefinidas se compararon con los de la base: ahora son los de la base **más** la nota del
    hallazgo (un `create or replace` borra el comentario anterior).
- Rondas del CI sobre el commit anterior (jobs `application`, `database` y `validacion` en rojo):
  - `application`: «versión `20270507140101` REUSADA: ya existe `20270507150100` o mayor en `origin/dokploy`» → las cuatro migraciones
    se renumeraron por encima del máximo real de la base (que a la vez avanzó a `20270507170000`).
  - `database`: `tienda_cierre_hallazgos.test.sql` (parse error: `duplicate key value violates unique constraint "existencias_pkey"`),
    `tienda_favoritos.test.sql` (20 de 111) y `tienda_menores_revision.test.sql` (1 de 50) → los tres corregidos (fixture, cupo del test
    y comentarios de las funciones).
- **No se pudo correr el pgTAP en este nodo**: no hay Postgres ni Docker (el socket de Docker da permission denied). Queda para el job
  `database` del CI.

## Deviations from Assessment

- **H-4 no lleva migración**: el diagnóstico inicial lo treataba como pendiente, pero al relevar la base se vio que ya está corregido
  por `20270430000000_tienda_menores_revision.sql` (con su propio pgTAP `tienda_menores_revision`). Se conserva la **prueba** en el
  pgTAP del cierre, adaptada a las definiciones vigentes, y la evidencia queda anotada en `docs/seguridad-tienda-compra-y-cuentas.md`
  (fila H-4). Duplicar la migración habría revertido los cambios de la base (catálogo acotado por ids, `dominio.clientes`).
- **Las cinco migraciones del PR original pasan a cuatro**: la de H-4 se elimina (arriba) y la de H-3 y la de H-6 se reconstruyen sobre
  los cuerpos vigentes, que es lo que pedía la auditoría de estados («rehacer las funciones sobre sus definiciones vigentes»).
- El front del PR aplicaba limpio (los archivos no cambiaron en la base desde el 2026-11-14), así que no hubo que adaptarlo.
- **La versión de las migraciones se calculó contra el máximo de la base en el momento de correr, y la base siguió avanzando**: el runner
  pasó `20270507150101` (máximo de la base `20270507150100`), pero `dokploy` recibió después el PR #1124 (`20270507170000`), así que
  esa versión ya era `REUSADA`. Se renumeraron a `20270507200101`–`20270507200104`: por encima del máximo real de `dokploy`
  (`20270507180800` al verificar; `20270507170000` cuando se renumeró) y por encima de `20270507200100`, la última migración de la rama
  de la épica, para que esta historia se integre en la épica sin choque de versión. Es lo que exige
  `scripts/verificar-migraciones.mjs` (`--estricto` en OK, código 0).
- **Devolución del Revisor (PR #1128)**: los ocho hallazgos se atienden en este commit. Dos decisiones que conviene que consten:
  (a) el re-apuntado de `dominio.consultas` desactiva el trigger `consultas_normalizar` **solo** para ese `update` (es DDL
  transaccional: si algo falla, la transacción se deshace y el trigger vuelve a estar activo) en vez de cambiar el trigger para toda la
  tabla, que afectaría a la actualización de consultas de la aplicación; (b) el conjunto de caracteres bloqueados se compara con un
  Vitest que lee la migración y el front (carácter por carácter sobre todo el BMP) en vez de mover el conjunto a un generador: el
  generador agregaría una herramienta al repo para un caso de un solo uso.

## Follow-ups

- H-1 (hash de IP reversible) queda trazado como **MSF-945** (no se corrige acá: la IP nunca se guarda en claro y el hash no sale de la
  base).
- El `statement_timeout` (57014) no lo atrapa `when others`: queda documentado como observación, sin cambio de código (la protección es
  el propio `statement_timeout` de los roles de la API).
- `private.precio_para`, `private.numero_cliente_consulta` y `private.nombre_cliente_consulta` tienen `execute` para `authenticated`:
  es seguro solo porque el esquema `private` no está expuesto por PostgREST. Hay que **verificar** `PGRST_DB_SCHEMAS` al desplegar y
  cada vez que se toque la configuración de PostgREST (queda dicho en la guía de seguridad).
