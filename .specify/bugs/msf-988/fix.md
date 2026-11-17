# Bug Fix: MSF-988 — cierre de los hallazgos H-2 a H-6 de MSF-176 sobre `dokploy` actual

- **Slug**: msf-988
- **Fixed**: 2026-11-17
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se rehízo el fix de seguridad del PR #965 (que quedó `CONFLICTING` desde el 2026-11-14) sobre `origin/dokploy` actual: las cuatro
migraciones del cierre se renumeraron (`20270507140101` a `20270507140104`) y sus cuerpos se reconstruyeron sobre las definiciones
vigentes de la base (no sobre las del 2026-11-14, que revertían cambios ya mergeados). H-4 no necesitó migración: ya estaba corregido
en `dokploy` por `20270430000000_tienda_menores_revision.sql`, y su prueba se conserva adaptada.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270507140101_presupuestos_tienda_vinculo_persistente.sql` | added | H-2 (parte 1): `cuenta_cliente_id` admite nulo y su FK pasa a `on delete set null (cuenta_cliente_id)`; las FK de cliente y comprobante pasan a `on delete cascade` (si no, la baja de la organización se bloqueaba). Referencia a `dominio.clientes` (la base movió la tabla en MSF-882). |
| `supabase/migrations/20270507140102_fusionar_clientes_repunta_tienda.sql` | added | H-2 (parte 2): `public.fusionar_clientes` repunta `dominio.presupuestos_tienda.cliente_id` y `dominio.consultas.cliente_id` al cliente conservado. Cuerpo = el vigente (`20270419000200`, con el bloque de opiniones de MSF-467 y `dominio.clientes`) más ese cambio. |
| `supabase/migrations/20270507140103_tienda_cupo_llamadas_cuenta.sql` | added | H-3: `private.limite_llamadas_cuenta_por_minuto()` (120) y cupo por cuenta en las cinco RPC de «Mi cuenta», tomado después de resolver la cuenta y antes de cualquier lectura, en un bloque anidado con su manejador (sobrevive a un error). Las cuatro que eran `stable` pasan a `volatile`. Cuerpos = los vigentes. |
| `supabase/migrations/20270507140104_tienda_caracteres_invisibles.sql` | added | H-6: conjunto de caracteres bloqueados ampliado (U+00AD, U+180E, U+2061 a U+2064) en `enviar_lista_pedido` y `crear_presupuesto_tienda`. Cuerpos = los vigentes (idénticos carácter a carácter salvo las dos constantes). |
| `supabase/tests/database/tienda_cierre_hallazgos.test.sql` | added test | 55 aserciones: H-2 (baja de cuenta, fusión y baja de organización), H-3 (cupo por cuenta en las cinco RPC, que sobrevive a un error), H-4 (el cupo de la lista y del envío sobrevive a una excepción) y H-6 (caracteres invisibles en B1 y B2). Adaptado a la base (`dominio.clientes`, firma de `precio_referencia_pedido`, `listar_presupuestos` con seis parámetros, cupo de 10 por minuto del presupuesto). |
| `apps/web/src/lib/tiendaCuentaDatos.ts` | modified | `limite` (H-3) es un error propio con reintento y su espera en segundos; no se confunde con «cuenta no está activa». |
| `apps/web/src/lib/tiendaCuentaDatos.test.ts` | added test | El `limite` del servidor en las cinco RPC → `ErrorCuentaTienda` con código `limite`, espera y texto propios. |
| `apps/web/src/lib/tiendaPedido.ts` | modified | Conjunto de caracteres bloqueados del front ampliado con el mismo de SQL (U+00AD, U+180E, U+2061 a U+2064). |
| `apps/web/src/lib/tiendaPedido.test.ts` | modified | El caso de los invisibles cubre el conjunto nuevo. |
| `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx` | added test | El límite de llamadas avisa el error con reintento y **no** dice «cuenta no está activa». |
| `scripts/medir-tienda-favoritos.sql` | modified | H-6: el script se niega a correr sin `-v BASE_DESCARTABLE=si` y en bases con más de 5 organizaciones. |
| `docs/seguridad-tienda-compra-y-cuentas.md` | modified | Registra la revisión integral (T070) con los hallazgos H-1 a H-6, la resolución de cada uno y las notas de H-5 y del `statement_timeout`. |
| `docs/tienda-compra-y-cuentas.md` | modified | Sección de cierre: qué cambia para quien opera o desarrolla, migraciones del cierre y pruebas. |
| `specs/20270306-100000-tienda-compra-y-cuentas/spec.md` | modified | DER: `cuenta_cliente_id` nullable con `on delete set null`. |
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
  texto propios, y `esSinAcceso` da `false`.
- `apps/web/src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx` — el aviso del límite no dice «cuenta no está activa» y el botón
  sigue disponible.

## Local Verification

- Commands run:
  - `pnpm --filter @platform/web lint` → **OK** (solo avisos preexistentes de `oxlint`, ninguno en los archivos tocados).
  - `pnpm build` (`tsc -b` + `vite build`) → **OK**.
  - `vitest run src/lib/tiendaCuentaDatos.test.ts src/lib/tiendaPedido.test.ts src/pages/tienda-publica/cuenta/BotonFavorito.test.tsx`
    → **71 pruebas en verde**.
  - `vitest run` de los archivos que dependen de `tiendaCuentaDatos` (`tiendaOpiniones`, `favoritosSoloEnLaTienda`,
    `useListadoPorCursor`, `useFavoritosEntre` y la carpeta `cuenta`) → **87 pruebas en verde**.
  - `pnpm docs:check` → **OK** (4 migraciones nuevas contra `origin/dokploy`, trampas conocidas: OK).
  - `node scripts/verificar-migraciones.mjs --estricto` → **OK**.
  - `pnpm matriz:check` → **OK**.
  - `node scripts/verificar-der.mjs specs/20270306-100000-tienda-compra-y-cuentas/spec.md` → **DER OK**.
  - `pnpm calidad` → `oxlint`, `knip`, `jscpd`, `dependency-cruiser` y `syncpack` en **OK**; `gitleaks` **no se pudo correr** (necesita
    Docker, sin permisos en este nodo).
- Manual checks:
  - Los cuerpos de `enviar_lista_pedido` y `crear_presupuesto_tienda` de `20270507140104` se compararon **carácter a carácter** con
    sus definiciones vigentes (`20270430000000` y `20270507130100`): idénticos salvo las dos constantes de caracteres.
  - Los cuerpos de las cinco RPC de «Mi cuenta» de `20270507140103` se compararon con los vigentes: la única diferencia es el cupo,
    el bloque anidado y `stable` → `volatile`.
  - El cuerpo de `fusionar_clientes` de `20270507140102` es el de `20270419000200` más los dos `update` que repuntan.
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

## Follow-ups

- H-1 (hash de IP reversible) queda trazado como **MSF-945** (no se corrige acá: la IP nunca se guarda en claro y el hash no sale de la
  base).
- El `statement_timeout` (57014) no lo atrapa `when others`: queda documentado como observación, sin cambio de código (la protección es
  el propio `statement_timeout` de los roles de la API).
- `private.precio_para`, `private.numero_cliente_consulta` y `private.nombre_cliente_consulta` tienen `execute` para `authenticated`:
  es seguro solo porque el esquema `private` no está expuesto por PostgREST. Hay que **verificar** `PGRST_DB_SCHEMAS` al desplegar y
  cada vez que se toque la configuración de PostgREST (queda dicho en la guía de seguridad).
