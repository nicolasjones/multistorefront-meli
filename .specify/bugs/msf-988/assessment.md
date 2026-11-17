# Bug Assessment: MSF-988 — PR #965 (cierre de hallazgos de MSF-176) rebaseado contra `dokploy`

- **Slug**: msf-988
- **Created**: 2026-11-17
- **Source**: descripción del tracker (MSF-988, seguimiento de MSF-176) + `gh pr view 965` + código de `origin/dokploy`
- **Verdict**: valid
- **Severity**: high

## Report (resumido)

El PR #965 (`feat/MSF-176-cierre-hallazgos` → `dokploy`) corrige los hallazgos H-2 a H-5 de la revisión de seguridad integral
independiente (T070) de MSF-176: la FK `presupuestos_tienda_cuenta_fk` que borraba el vínculo del presupuesto al dar de baja una
cuenta, `fusionar_clientes` dejando referencias al cliente archivado, y la falta de cupo de llamadas en las cinco RPC de «Mi cuenta»
y en la lista de pedido/envío de B1.

Quedó creado el 2026-11-14, `mergeable: CONFLICTING` desde ese momento y **cero commits ni comentarios desde entonces**. Los checks
`application` y `validacion` están en rojo. El commit cabeza (`4f22868d3`) **no** es ancestro de `origin/dokploy`: el fix no llegó a
la rama por otro camino. El resto del cierre de MSF-176 (PRs #963, #964, #966, #1002) ya está mergeado; este PR quedó huérfano.

## Symptom

El PR no se puede mergear: la rama quedó atrás de `dokploy` y sus migraciones (`20270322200000` a `20270322200400`) pisan números que
la base ya renumeró. Además, aunque se rebaseara a ciegas, sus cuerpos de función y sus referencias a objetos están **desactualizados**
respecto de la base: el PR se escribió sobre `dokploy` del 2026-11-14 y la base avanzó (clientes al esquema `dominio`, catálogo efectivo
acotado por ids, lista de precios del cliente en la lista de pedido, filtro por origen en `listar_presupuestos`, aviso por correo al
equipo en el presupuesto de la tienda).

Es decir: el fix de seguridad **no está en producción** (la FK en cascada real y la ausencia de cupo siguen ahí) y, tal como está,
no se puede aplicar.

## Reproduction

1. `gh pr view 965 --json mergeable,mergeStateStatus` → `CONFLICTING` / `DIRTY`.
2. `git merge-base --is-ancestor 4f22868d3 origin/dokploy` → falso (el fix no está en la base).
3. `git diff --name-only b98c7945 origin/dokploy -- supabase/migrations` → la base tiene ~120 migraciones nuevas desde el punto de
   divergencia del PR, entre ellas `20270430000000_tienda_menores_revision.sql` (que **ya** corrige H-4) y
   `20270418000401_clientes_a_dominio.sql` (que mueve `public.clientes` a `dominio.clientes`).
4. Aplicar el SQL del PR sobre la base actual: `public.clientes` ya no existe (la migración del PR crea la FK
   `presupuestos_tienda_cliente_fk` contra `public.clientes` → error de relación inexistente); `public.listar_presupuestos` tiene un
   sexto parámetro (MSF-942) y `private.precio_referencia_pedido` una firma de cinco argumentos (MSF-969): los cuerpos del PR
   revierten cambios ya mergeados.

## Suspected Code Paths

- `supabase/migrations/20270322200000_presupuestos_tienda_vinculo_persistente.sql` (H-2, parte 1) — la FK de la cuenta y las de cliente
  y comprobante de `dominio.presupuestos_tienda`; referencia `public.clientes` (hoy `dominio.clientes`).
- `supabase/migrations/20270322200100_fusionar_clientes_repunta_tienda.sql` (H-2, parte 2) — redefinición de `public.fusionar_clientes`
  a partir de `20270205110203`; la versión vigente es `20270419000200` (opiniones de MSF-467, `dominio.clientes`, `lista_precio_id`).
- `supabase/migrations/20270322200200_tienda_cupo_llamadas_cuenta.sql` (H-3) — las cinco RPC de «Mi cuenta»; sus cuerpos son los del
  2026-11-14 (sin catálogo acotado por ids, sin lista de precios del cliente).
- `supabase/migrations/20270322200300_tienda_cupo_sobrevive_lista_y_envio.sql` (H-4) — **ya está en `dokploy`** por
  `20270430000000_tienda_menores_revision.sql`: el PR lo duplicaría (y con cuerpos viejos).
- `supabase/migrations/20270322200400_presupuesto_caracteres_invisibles.sql` (H-6) — redefine `enviar_lista_pedido` y
  `crear_presupuesto_tienda` con cuerpos viejos (sin `dominio.clientes`, sin catálogo por ids, sin el aviso al equipo).
- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` — el pgTAP del PR: inserta en `clientes` (hoy `dominio.clientes`) y
  reemplaza `private.precio_referencia_pedido` con la firma de cuatro argumentos (la vigente tiene cinco).
- `apps/web/src/lib/tiendaCuentaDatos.ts` y `apps/web/src/lib/tiendaPedido.ts` — el front del cupo (`limite`) y del conjunto de
  caracteres: **no cambiaron** en la base, el diff del PR aplica limpio.

## Root Cause Hypothesis

Confianza alta. El PR quedó abierto contra una base que siguió avanzando: nadie lo retomó tras el resto del cierre de MSF-176
(#963/#964/#966/#1002 mergeados). Sus migraciones quedaron con versiones ya renumeradas y sus cuerpos de función y referencias a
objetos quedaron atrás de la base, así que no se puede mergear tal cual ni aplicar «a ciegas»: hay que **rehacer el fix sobre las
definiciones vigentes** (lo mismo que pidió la auditoría de estados del 2026-11-17: «hay que rehacer las funciones sobre sus
definiciones vigentes»).

## Proposed Remediation

**Preferred**: rehacer el PR sobre `origin/dokploy` actual:

1. **Numerar** las migraciones del cierre por encima del máximo real de la base (`20270507170001` en adelante) y reconstruir cada
   cuerpo sobre la **definición vigente** en `dokploy` (no sobre la del 2026-11-14): `fusionar_clientes` sobre
   `20270419000200`, las cinco RPC de «Mi cuenta» sobre `20270430000000`/`20270320100300`/`20270320100400`, `enviar_lista_pedido`
   sobre `20270430000000` y `crear_presupuesto_tienda` sobre `20270507130100`.
2. **H-4 no necesita migración**: ya está corregido en `dokploy` por `20270430000000_tienda_menores_revision.sql` (con su pgTAP
   `tienda_menores_revision`). Se conserva la **prueba** en el pgTAP del cierre, adaptada a las definiciones vigentes.
3. **Adaptar el pgTAP** a la base: `dominio.clientes`, la firma de cinco argumentos de `precio_referencia_pedido`, el sexto parámetro
   de `listar_presupuestos` y los nuevos topes por cuenta (el cupo de `crear_presupuesto_tienda` es de 10 por minuto).
4. **Front**: el diff del PR aplica limpio (los archivos no cambiaron en la base): `limite` como error con reintento en
   `tiendaCuentaDatos.ts` y el conjunto de caracteres ampliado en `tiendaPedido.ts`.
5. **Docs**: registrar los hallazgos en `docs/seguridad-tienda-compra-y-cuentas.md` (H-1 a H-6), en la guía funcional y en el contrato
   de la spec.

**Alternatives**:
- Merge manual de los conflictos de Git sin rehacer los cuerpos: **descartado**; revertiría cambios ya mergeados (catálogo por ids,
  lista de precios, aviso al equipo) y las migraciones fallarían al aplicarse (`public.clientes` ya no existe).
- Dejar H-4 sin probar en este PR: **descartado**; el cierre tiene que dejar la prueba de cada hallazgo sobre el código vigente.

**Files likely to change**:
- `supabase/migrations/20270507170001_presupuestos_tienda_vinculo_persistente.sql` (nueva)
- `supabase/migrations/20270507170002_fusionar_clientes_repunta_tienda.sql` (nueva)
- `supabase/migrations/20270507170003_tienda_cupo_llamadas_cuenta.sql` (nueva)
- `supabase/migrations/20270507170004_tienda_caracteres_invisibles.sql` (nueva)
- `supabase/tests/database/tienda_cierre_hallazgos.test.sql` (nueva)
- `apps/web/src/lib/tiendaCuentaDatos.ts`, `apps/web/src/lib/tiendaCuentaDatos.test.ts`
- `apps/web/src/lib/tiendaPedido.ts`, `apps/web/src/lib/tiendaPedido.test.ts`
- `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx`
- `scripts/medir-tienda-favoritos.sql`
- `docs/seguridad-tienda-compra-y-cuentas.md`, `docs/tienda-compra-y-cuentas.md`
- `specs/20270306-100000-tienda-compra-y-cuentas/spec.md`, `specs/20270306-100000-tienda-compra-y-cuentas/contracts/tienda-compra-y-cuentas.md`

**Tests to add or update**:
- pgTAP `supabase/tests/database/tienda_cierre_hallazgos.test.sql`: H-2 (baja de cuenta, fusión, baja de organización), H-3 (cupo por
  cuenta en las cinco RPC y que sobreviva a un error), H-4 (el cupo de la lista y del envío sobrevive a una excepción), H-6 (caracteres
  invisibles en B1 y B2).
- Vitest `apps/web/src/lib/tiendaCuentaDatos.test.ts`: un `limite` del servidor es un error con reintento, no «cuenta no activa».
- Vitest `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx`: el aviso del límite no dice «cuenta no está activa».

## Devolución del Revisor (2026-11-17, PR #1128 sobre `e18615a4b`)

El Revisor devolvió el PR con **cambios solicitados** (revisión técnica + seguridad). Los ocho hallazgos y qué se hizo con cada
uno (el detalle técnico está en `fix.md`):

| # | Hallazgo | Severidad | Qué se hizo |
|---|---|---|---|
| 1 | Las cuatro migraciones del cierre quedaban por debajo del máximo real de la base → «versión REUSADA» en el job `application` (y el aplicador nunca las correría). | Alta | Renumeradas a `20270507170001`–`20270507170004` (por encima de `20270507170000`, el máximo real de `dokploy`), sin tocar el SQL. |
| 2 | La evidencia de `.specify/bugs/msf-988/{fix,test,assessment}.md` describía un estado que no existía (el guard salía con código 1 y los máximos citados eran los viejos). | Media | Corregida: los tres documentos dicen el máximo real (`20270507170000`), las versiones nuevas y la salida real del guard. |
| 3 | `fusionar_clientes` no repuntaba `cuenta_cliente_id`: los presupuestos del cliente al que se da de baja la cuenta quedaban sin cuenta (fuera de los topes FR-057 y de la idempotencia `(cuenta, clave)`). El pgTAP fijaba ese detachment como comportamiento. | Media | La fusión pasa esos presupuestos a la cuenta que sobrevive de la misma empresa antes de darla de baja; el pgTAP ahora cubre los **dos** casos del diálogo (se conserva la cuenta del conservado y la del descartado) y exige que la cuenta que sobrevive no arranque en cero. |
| 4 | `MENSAJE_LIMITE` y `esperaSegundos` nunca llegaban a la pantalla: un `limite` era indistinguible de una caída de red. | Baja | El error del cupo lleva los segundos en su texto; `useListadoPorCursor` expone el aviso con la espera (el patrón compartido de `CargaInfinita` con `espera`), `useFavoritosEntre` avisa el cupo, y las tres pantallas lo muestran (ficha, historial y favoritos). |
| 5 | El conjunto de caracteres bloqueados vivía en tres lugares y ningún test decía que fueran iguales. | Baja | Vitest nuevo (`tiendaPedido.caracteres.test.ts`) que compara **carácter por carácter** el conjunto del SQL con el del front sobre todo el BMP, y que exige que las dos funciones del servidor usen el mismo conjunto. |
| 6 | El contrato y la guía decían que solo `favoritos_entre_por_dominio` pasa a `volatile`, pero cambian las cinco. | Baja | Corregido el contrato y la guía de seguridad (las cinco cambian; `cambiar_favorito_por_dominio` ya era `volatile`). |
| 7 | El camino de reversión de la migración del vínculo era incompleto: `set not null` revienta con las filas de cuenta nula (justo lo que la migración produce). | Baja | La tabla de migraciones de la guía dice de borrar o reasignar esas filas antes. |
| 8 | El re-apuntado de `dominio.consultas` hacía avanzar `updated_at` (trigger `consultas_normalizar`): los pedidos re-apuntados aparecían como modificados ahora. | Baja | La fusión desactiva ese trigger solo para ese `update` (es DDL transaccional) y el pgTAP comprueba que la consulta conserva su `updated_at`. |

Además, el CI en rojo del commit anterior señalaba tres cosas del job `database` (el `duplicate key` del fixture del pgTAP del cierre,
la ráfaga de 203 favoritos contra el cupo nuevo y el comentario de `mis_compras_por_dominio` que perdía el «DEFENSA EN PROFUNDIDAD»):
las tres están corregidas y documentadas en `fix.md`.

## Risks & Considerations

- **Sin Postgres local en este nodo** (ni Docker): el pgTAP no se puede correr antes de pushear; el job `database` del CI es el que lo
  ejecuta. Por eso los cuerpos se copiaron **literalmente** de la definición vigente y se verificaron por diferencia carácter a
  carácter contra la migración de origen.
- `on delete set null (cuenta_cliente_id)` y `on delete cascade` exigen PostgreSQL 15 o más (la base corre 17). ✓
- Las FK de cliente y comprobante pasan a `cascade`: el cliente archivado por la fusión no se borra y un comprobante no se borra en el
  flujo normal; solo la baja de la organización llega por ese camino.
- Tocar `dominio.presupuestos_tienda` es un cambio de datos (FK): es **aditivo** en el sentido de que no borra columnas ni tablas, pero
  cambia la regla de borrado → su camino de reversión queda documentado en la migración (FK de la cuenta a `cascade` y las otras dos a
  `no action`, más `set not null` en la columna).
- H-6 cambia el conjunto de caracteres rechazados: es un **endurecimiento** (rechaza más), no una relajación; el front usa el mismo
  conjunto.

## Open Questions

- Ninguno bloqueante: el alcance (H-2 a H-6, con H-1 ya trazado como MSF-945) y las decisiones de diseño están en el PR #965 y en
  `docs/seguridad-tienda-compra-y-cuentas.md` del PR original.
