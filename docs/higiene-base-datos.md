---
owner: plataforma
sources:
  - supabase/migrations/20270507190000_indices_en_claves_foraneas_public.sql
  - supabase/migrations/20270507190100_indices_en_claves_foraneas_dominio.sql
  - supabase/migrations/20270507190200_cotizaciones_clave_primaria_surrogada.sql
  - supabase/migrations/20270507190300_politicas_denegar_todo_tablas_sin_politica.sql
  - supabase/migrations/20270507190400_validar_fk_conexiones_sistema_externo.sql
  - supabase/migrations/20270507190500_definer_search_path_vacio_funciones_seguras.sql
  - supabase/migrations/20270507190600_indice_fk_cobros_comprobante_revierte.sql
  - supabase/tests/database/seguridad_global_higiene_base.test.sql
  - supabase/verificacion/higiene_base.sql
  - supabase/verificacion/higiene_base_migraciones.sql
  - scripts/verificar-higiene-base.mjs
  - scripts/analizar-definer-search-path.mjs
---

# Higiene y endurecimiento de la base de datos (lote 33)

Qué corrige el código (migraciones + pruebas pgTAP globales) y qué es **estado de la base viva** (DEV) que se
diagnostica y reconcilia con el runbook de abajo. Los números de las auditorías (137 FK, 462–750 funciones, 357 sin
statements) son del DEV; las migraciones del repo, aplicadas desde cero, dan otros (ver «Deriva entre repo y DEV»).

## Qué quedó resuelto en código

| Ítem | Qué se hizo | Dónde |
|---|---|---|
| MSF-918 FK sin índice | 154 índices `create index if not exists` (42 en `public`, 112 en `dominio`; el último, el de la FK del contra-asiento de cobros del lote 32) | `20270507190000`, `…190100`, `…190600` |
| MSF-918 RLS sin política | 16 tablas con política explícita que **deniega todo** a `anon` y `authenticated` (mismo efecto que antes, ahora declarado) | `…190300` |
| MSF-918 vista sin `security_invoker` | **No se cambia**: `public.proveedores_basico` es definer a propósito (ver abajo); una prueba fija que sea la única | pgTAP global |
| MSF-922 tablas sin PK | `dominio.cotizacion_aplicada` y `dominio.cotizacion_pendiente`: PK sustituta `id uuid` | `…190200` |
| MSF-923 FK `NOT VALID` | `conexiones_sistema_externo_fkey`: se valida solo si no hay huérfanos; si los hay, avisa y no toca datos | `…190400` |
| MSF-669 pruebas globales | `seguridad_global_higiene_base.test.sql` (17 casos) | pgTAP |
| MSF-899/917 `search_path` | 6 funciones migradas a `''`; 3 documentadas (abajo) | `…190500` + script |

### Criterio de los índices en FK (MSF-918)

Se indexa toda FK cuyas columnas no sean ya prefijo de un índice válido y no parcial, **salvo**:

- FK a `auth.users` con `on delete set null` (columnas de autoría `creado_por`, `actualizado_por`…): bajar un usuario es raro y
  el índice encarece las escrituras de las tablas más activas;
- FK a catálogos chicos y casi estáticos: `sistemas_externos`, `ia_perfiles_modelo`, `capacidades_proveedores`,
  `roles_organizacion`, `dominio.alicuotas_iva`, `dominio.estados_reparacion`, `dominio.motivos_movimiento`.

`concurrently` no se puede usar en una migración (el aplicador corre cada una dentro de una transacción: `create index
concurrently cannot run inside a transaction block`). Se usa `create index if not exists`, que toma `SHARE` sobre la tabla
mientras construye (bloquea escrituras, no lecturas). En un entorno donde una de estas tablas supere ~1M de filas, construir
antes el mismo índice a mano con `create index concurrently if not exists <mismo nombre>` y dejar la migración como no-op.
La prueba global falla si aparece una FK nueva sin índice y fuera de esas dos excepciones. Reproducir el listado:
`node scripts/verificar-higiene-base.mjs --docker <contenedor>`.

Con el DEV al 97 % de almacenamiento en índices (MSF-920), cada índice nuevo cuesta: **antes de promover** medir el espacio
(consulta de «MSF-920» abajo) y, si hace falta, retirar primero índices sin uso. Estos 154 índices (153 de `20270507190000`/`…190100` más 1 de `…190600`, la FK del contra-asiento de cobros del lote 32) se justifican por las cascadas
(baja de organización) y los joins por FK; si el diagnóstico de uso muestra alguno sin lecturas tras un ciclo, se retira con
`drop index` en una migración posterior.

### `public.proveedores_basico` (vista sin `security_invoker`)

Es `security_invoker = false` **a propósito** (F-PRV-03): el Operador (sección `proveedores` en `ninguno`) no tiene `select`
sobre `dominio.proveedores`; con `security_invoker = true` esos usuarios verían la vista vacía y se rompen los selectores de
productos e ingresos. La vista filtra por organización y nivel de sección, expone solo `id`, `razon_social`, `activo` y `anon`
no la lee. La prueba global exige que sea la única vista de `public`/`dominio` en ese estado.

### PK de las cotizaciones (MSF-922)

La PK por `organizacion_id` se descartó en `20270213100002` (cotización por empresa): la unicidad pasó a un índice único
funcional `(organizacion_id, coalesce(empresa_id, uuid nulo))`, que no puede ser PK. No hay duplicados que tratar: el índice
único sigue siendo la clave natural y `id` es un identificador propio por fila (la migración lo verifica y lo regenera si
una aplicación parcial lo dejó repetido).

### FK `NOT VALID` (MSF-923)

Si el DEV tiene conexiones cuyo `sistema_externo` no está en `sistemas_externos`, la migración **no borra nada**: emite un
`warning` con la cantidad y los valores, y la FK sigue `NOT VALID`. Reparar a mano y repetir:

```sql
select c.id, c.sistema_externo from public.conexiones c
 where not exists (select 1 from public.sistemas_externos s where s.id = c.sistema_externo);
-- cargar el sistema faltante en sistemas_externos (preferido) o corregir la conexión; luego:
alter table public.conexiones validate constraint conexiones_sistema_externo_fkey;
```

## `search_path` de las funciones `security definer` (MSF-899 / MSF-917)

`node scripts/analizar-definer-search-path.mjs --docker <contenedor>` (o `DATABASE_URL`) lista las funciones definer cuyo
`search_path` no es `''` y las clasifica: **segura** (el cuerpo califica todo o no referencia objetos) o **a revisar** (objetos
sin calificar, operadores de extensiones o SQL dinámico). Es conservador y solo lectura. Una «segura» además debe pasar toda la
suite pgTAP antes de migrarse; no se cambia ninguna en bloque a ciegas.

Lo que el análisis **NO detecta** (sigue siendo trabajo de revisión humana; por eso una «segura» exige además la suite completa): un `set local search_path` dentro del cuerpo, operadores calificados `OPERATOR(esquema.op)` y los no calificados de extensiones fuera de la lista fija (`<=>`, `<->`, `<#>`, `%`, `%>`, `<%`, `@@@`), SQL dinámico (cualquier `execute`/`format` se marca «a revisar» sin analizar el texto armado), objetos sin calificar referenciados solo por funciones que llama (se evalúa cada cuerpo por separado) y tablas/funciones/tipos creados después del análisis. No analiza vistas, triggers ni defaults de columna que invoquen funciones.

Con las migraciones del repo quedaban 9 funciones; 6 eran seguras y se migraron con `alter function … set search_path = ''`:
`private.registrar_cambios_seguridad_usuario`, `public.registrar_inicio_sesion(jsonb)`,
`private.procesar_falla_orquestacion(uuid,uuid,text)`, `public.bloqueo_acceso_hasta(text)`,
`private.purgar_evidencias_ia(timestamptz)`, `public.limpiar_intentos_acceso()`.

Pendientes (a revisar), todas de `20260909…`, en el camino caliente de **toda** política RLS:

| Función | Referencia sin calificar | Plan |
|---|---|---|
| `private.is_superadmin()` | `superadmins` | calificar `public.superadmins` y pasar a `''` |
| `private.organizacion_id()` | `usuarios_organizacion` | calificar `public.usuarios_organizacion` y pasar a `''` |
| `private.puede_escribir()` | `usuarios_organizacion` | ídem |

**Riesgo de secuestro de `search_path` mientras estén en `public`**: se mitiga porque `anon` y `authenticated` **no tienen `CREATE` sobre el esquema `public`** (PG15 lo revoca a `PUBLIC` por defecto; verificado con `has_schema_privilege('anon','public','CREATE')` y `has_schema_privilege('authenticated','public','CREATE')`, ambos `false`, en el Postgres descartable pgvector 0.8.0-pg15). Nadie que no sea dueño puede crear en `public` un objeto que sombree a `superadmins` o `usuarios_organizacion`. `verificar-higiene-base.mjs` lo comprueba en cada base (control `anon_authenticated_create_en_public`, esperado 0) y es solo diagnóstico, no una aserción de pgTAP, porque depende del `grant` del entorno y no del código.

Van en una migración propia, con la suite completa y una medición de plan de consulta (son `stable` y las usan las
políticas; no deben perder la inlineabilidad). La prueba global tiene estas tres como lista permitida: al migrarlas se
quita de la lista.

**Deriva repo ↔ DEV.** El DEV reporta 462–750 funciones con `search_path = public`; el repo, aplicado desde cero, deja 771
funciones definer con `''` y solo esas 9 distintas. La diferencia es de la base viva (funciones creadas o reaplicadas a mano,
migraciones «aplicada-manual»): se corrige reconciliando el DEV con el runbook, no con una migración masiva. Después de
reconciliar, correr el script de análisis contra el DEV: lo que liste ahí sí es candidato real, con el mismo criterio.

## Qué corre en el CI

Los scripts `verificar-higiene-base.mjs` y `analizar-definer-search-path.mjs` son de diagnóstico contra una base viva y no corren en el
CI; lo que sí corre son sus **pruebas unitarias** (`scripts/verificar-higiene-base.test.mjs`, `scripts/analizar-definer-search-path.test.mjs`)
dentro de `pnpm test:db:guard-migraciones`, que el job `chequeos` de `validate.yml` ejecuta en cada PR. La prueba pgTAP
`seguridad_global_higiene_base.test.sql` corre con el resto de `pnpm test:db`.

## Runbook: higiene del DEV (MSF-658 / MSF-671) — solo diagnóstico, no se ejecuta desde el repo

Estado de la **base viva**, no del código. Los comandos son de solo lectura salvo la sección «Reconciliación», que requiere
aprobación y se corre contra una copia primero.

### Diagnóstico

```bash
# 1. Controles de higiene (FK sin índice, RLS sin política, sin PK, NOT VALID, vistas, definer, superficie anon, CREATE en public, migraciones)
#    (los controles del registro de migraciones se omiten solos si la base no tiene supabase_migrations)
node scripts/verificar-higiene-base.mjs --docker <contenedor-db-dev> --versiones
# 2. Funciones definer con search_path distinto de ''
node scripts/analizar-definer-search-path.mjs --docker <contenedor-db-dev>
```

`--versiones` compara `supabase_migrations.schema_migrations` con `supabase/migrations`:

- **Migración huérfana** (MSF-658): versión registrada en la base sin archivo en el repo (se aplicó a mano o su archivo se
  renumeró/borró). Ver cuál es: `select version, name from supabase_migrations.schema_migrations where version = '<v>';` y
  buscar el nombre con `git log --all --diff-filter=D --name-only -- supabase/migrations | grep <nombre>`.
- **«aplicada-manual»** (13): migraciones cuyo registro se insertó a mano (el `insert` del runbook) sin que el SQL corriera, o
  cuyo SQL se corrió a mano sin el registro del aplicador. El síntoma es deriva de objetos (p. ej. el ACL de `publico.*`
  distinto del que fija la migración). Verificar objeto por objeto, no por el registro.
- **«Sin statements»** (357, MSF-671): el cron `migrar-supabase-vps.sh` registra cada migración con `statements = '{}'` **por
  diseño** (no usa el CLI, que guardaría el SQL). Una fila con `statements` vacío **no** indica que no se aplicó. El control
  `migraciones_sin_statements` es informativo; lo que importa es que el objeto exista.

### Verificar un objeto aplicado «a mano»

```sql
-- ¿existe el objeto que crea la migración? (ejemplos)
select to_regclass('dominio.cotizacion_aplicada');
select has_function_privilege('anon', 'publico.crear_consulta_publica(text,text,text)'::regprocedure, 'execute');  -- debe ser false
select proconfig from pg_proc where oid = 'private.is_superadmin()'::regprocedure;
```

### Reconciliación (con aprobación; primero en una copia restaurada del DEV)

1. Huérfana con archivo renombrado: registrar con la versión nueva (`insert … on conflict (version) do nothing`) **solo si**
   el objeto ya existe; si no existe, dejar que el cron la aplique.
2. Objeto aplicado a mano y registro ausente: el cron reintenta; las migraciones son idempotentes (`if not exists`), así que
   reaplicar es seguro. Si no lo es, registrar a mano y dejar nota en el ticket.
3. Deriva de ACL/`search_path`: reaplicar el `revoke`/`alter function` de la migración correspondiente (están en el repo) y
   re-ejecutar el paso de diagnóstico hasta que los controles den los valores esperados.
4. No borrar filas de `schema_migrations` para «limpiar»: el aplicador volvería a ejecutar esa migración.

Esperado tras reconciliar: todos los controles de `verificar-higiene-base.mjs` en su valor esperado y `--versiones` sin
huérfanas.

## Diagnóstico y plan (MSF-920 / MSF-921) — sin migrar tablas de negocio en este lote

### MSF-920: 97 % del almacenamiento en índices

```sql
-- tamaño de índices vs tablas, por tabla
select relname, pg_size_pretty(pg_table_size(relid)) as tabla, pg_size_pretty(pg_indexes_size(relid)) as indices,
       round(pg_indexes_size(relid)::numeric / nullif(pg_total_relation_size(relid), 0), 2) as fraccion_indices
  from pg_stat_user_tables order by pg_indexes_size(relid) desc limit 30;
-- índices sin lecturas desde el último reset de estadísticas (candidatos; excluir únicos/PK)
select s.schemaname, s.relname, s.indexrelname, pg_size_pretty(pg_relation_size(s.indexrelid)) as tam, s.idx_scan
  from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid
 where s.idx_scan = 0 and not i.indisunique and not i.indisprimary order by pg_relation_size(s.indexrelid) desc limit 50;
-- índices duplicados (mismas columnas y predicado)
select indrelid::regclass, array_agg(indexrelid::regclass) as duplicados
  from pg_index group by indrelid, indkey, indclass, indpred::text, indexprs::text having count(*) > 1;
```

Plan: (1) medir con `pg_stat_reset()` desactivado y al menos un ciclo de uso real; (2) retirar duplicados (sin riesgo);
(3) retirar índices sin lecturas que no sean únicos ni respalden una FK de cascada; (4) revisar índices `gin`/trigram de
texto sobre tablas con pocas filas; (5) `reindex index concurrently` para los hinchados (fuera de migración). Cada retiro
es `drop index if exists` en una migración con su reversión (el `create index` original). Una base con 97 % en índices suele
indicar mucho dato chico y tablas de log con índices de más: empezar por las de mayor `fraccion_indices`.

### MSF-921: tablas de negocio en `public` sin gemela en `dominio`

Principio VII: dominio del producto en `dominio`, plataforma en `public`. Candidatas a revisar (con `organizacion_id` y sin
gemela en `dominio`, repo desde cero): `cuentas_cliente`, `clientes_empresas`, `usuarios_empresas`, `avisos_pendientes`,
`resumen_semanal_config`, `resumen_semanal_envios`, `migracion_cargas`, `procesos_masivos`, `procesos_masivos_errores`,
`documentos`/`fragmentos_indexados`, `solicitudes_acceso`. Listar con:

```sql
select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and not c.relispartition
   and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organizacion_id' and not a.attisdropped)
   and not exists (select 1 from pg_class d where d.relnamespace = 'dominio'::regnamespace and d.relname = c.relname) order by 1;
```

Clasificar cada una (plataforma legítima en `public` vs negocio que debe vivir en `dominio`); las de negocio se mueven de a
una en lotes propios (`alter table … set schema dominio` + vista de compatibilidad en `public` mientras la app y los workers
migran, grants, RLS, exportación total y pgTAP). **No se migra ninguna en este lote**: cambia el contrato (PostgREST, RPC, exportaciones, workers).
