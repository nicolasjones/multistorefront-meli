# Quickstart: Catálogo real para sistema_externo en conexiones

Valida de punta a punta que `conexiones.sistema_externo` ahora tiene
integridad referencial real contra un catálogo, sin romper nada existente de
spec 013. Ver `data-model.md` para el detalle de columnas/constraints.

## Prerrequisitos

- `pnpm dev:supabase` corriendo (stack Supabase local levantado).
- Migración de esta spec aplicada (`supabase migration up` o el flujo que ya
  use `pnpm dev:supabase` para aplicar migraciones nuevas).

## Validación 1: el catálogo se crea vacío

```sql
select count(*) from sistemas_externos;
-- esperado: 0
```

Confirma FR-002: esta migración no carga ningún valor de negocio.

## Validación 2: crear_conexion falla sin catálogo (User Story 1, escenario 1)

Como un `authenticated` administrador de una organización existente:

```sql
select public.crear_conexion(
  '<organizacion_id existente>',
  'sistema-que-no-existe',
  'credencial-de-prueba'
);
-- esperado: error 23503 (foreign_key_violation)
```

## Validación 3: crear_conexion funciona con un valor del catálogo (User Story 1, escenario 2)

```sql
insert into sistemas_externos (id, descripcion)
  values ('demo', 'Sistema de demostración para validar esta spec');

select public.crear_conexion(
  '<organizacion_id existente>',
  'demo',
  'credencial-de-prueba'
);
-- esperado: fila creada, igual que antes de esta spec
```

## Validación 4: solo lectura para cualquier autenticado (User Story 1, escenario 3)

```sql
-- como authenticated:
select * from sistemas_externos; -- funciona (policy de select)
insert into sistemas_externos (id, descripcion) values ('x', 'y');
-- esperado: error 42501 (insufficient_privilege) — sin grant de insert
```

## Validación 5: suite pgTAP completa

```bash
pnpm test
```

Cubre, además de lo de arriba:

- `supabase/tests/database/catalogo_sistemas_externos.test.sql` (nuevo):
  las 4 validaciones de arriba, automatizadas.
- Los 5 archivos de test existentes que insertan `conexiones` directo
  (`ciclo_ejecuciones_workers`, `conexion_invalida_trabada`,
  `ejecucion_en_curso_worker`, `outbox_ejecuciones`,
  `orquestacion_multi_organizacion`) siguen en verde con su fixture de
  catálogo agregado — confirma que la FK `NOT VALID` no rompe ningún flujo
  existente de spec 013/016/019.

## Validación 6: la migración no falla con datos huérfanos preexistentes (User Story 2)

Este template no tiene datos de negocio en `conexiones` (no hay ninguna
carga en ninguna migración), así que este escenario no es reproducible tal
cual acá — queda documentado para que un fork lo confirme contra su propia
base antes de traer esta spec:

```sql
-- Antes de aplicar la migración de esta spec, en una base CON datos reales:
select count(*) from conexiones where sistema_externo not in (select id from sistemas_externos);
-- Aplicar la migración de esta spec.
-- esperado: la migración se completa sin error pese a que esas filas existen
-- (constraint NOT VALID — ver data-model.md).
```
