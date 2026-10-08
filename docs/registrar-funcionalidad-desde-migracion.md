# Registrar una funcionalidad desde una migración

`public.registrar_feature`/`public.habilitar_feature` (spec 009, panel de
funcionalidades) son RPCs `security definer` que exigen
`private.is_superadmin()` — es decir, `auth.uid()` no nulo. Una migración de
Supabase corre fuera de una sesión de PostgREST: no hay JWT, `auth.uid()`
devuelve `NULL`, y la llamada revienta con `42501` ("Solo un superadmin
puede registrar funcionalidades").

Este patrón no es exclusivo de `registrar_feature` — aplica a **cualquier
RPC futura, de cualquier spec, que exija `private.is_superadmin()` (o
cualquier otro chequeo basado en `auth.uid()`) y necesite llamarse desde
una migración** en vez de desde el navegador.

## El patrón

Impersonar al primer superadmin existente vía `set_config`, igual que
PostgREST resuelve `auth.uid()` a partir del JWT real en cualquier request
(`auth.uid()` lee `coalesce(request.jwt.claim.sub,
request.jwt.claims->>'sub')` — la migración solo necesita fijar esa misma
GUC):

```sql
do $$
declare
  v_actor uuid;
begin
  select user_id into v_actor from public.superadmins order by user_id limit 1;

  if v_actor is null then
    -- Ver la sección siguiente: no usar raise exception acá.
    raise notice 'No existe ningún superadmin todavía — esta migración queda para que lo complete seed.sql o un alta manual posterior';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);

  -- A partir de acá, cualquier RPC que dependa de auth.uid()/private.is_superadmin()
  -- funciona como si la llamara ese superadmin — el `true` final de
  -- set_config la hace local a esta transacción, no persiste.
  perform public.registrar_feature('mi-funcionalidad', 'Mi funcionalidad', 'Descripción visible.');
end $$;
```

## Por qué `raise notice` y no `raise exception` si no hay superadmin

`supabase db reset` (local o en CI) aplica **todas** las migraciones antes
de `seed.sql` — en ese punto todavía no existe ningún superadmin (lo crea
`seed.sql`, o un alta manual en producción). Un `raise exception` acá rompe
cualquier reset desde cero, no solo CI.

- En un reset desde cero: `seed.sql` completa el registro después de crear
  su superadmin, con las mismas llamadas (`registrar_feature`/
  `habilitar_feature`) y el mismo guard de idempotencia (`if not exists`).
- En un despliegue real contra una base ya en marcha (superadmin ya
  existente): la migración sola alcanza, no depende de `seed.sql`.

## Idempotencia

`registrar_feature` se envuelve en `if not exists (select 1 from
public.features where id = '...')`; `habilitar_feature` ya es idempotente
por su cuenta (`on conflict do nothing`). Una migración que use este patrón
debe poder reaplicarse (o convivir con un `seed.sql` que repite las mismas
llamadas) sin duplicar filas ni fallar.
