# Aislamiento por organización

Regla para toda tabla que guarda datos de una organización (spec
`20261012-140000-acceso-y-organizacion`, F-ORG-01, FR-011/FR-012). Se apoya en
el mecanismo del template (spec 003, `fundacion_multitenant`); no se reinventa.

## Regla para tablas de dominio

1. La tabla lleva `organizacion_id uuid not null references organizaciones(id)`.
2. `alter table ... enable row level security` en la **misma migración** que la
   crea. Sin RLS no hay tabla expuesta.
3. Políticas por organización con las funciones del template:
   - lectura: `using (organizacion_id = private.organizacion_id())`
   - escritura (`insert`/`update`/`delete`): además `and private.puede_escribir()`,
     tanto en `using` como en `with check`.
4. La migración declara el esquema de la tabla: plataforma o autenticación en
   `public`; datos del producto en `dominio` (ver Constitución VII). Ambos están
   expuestos por la API (`[api] schemas` en `supabase/config.toml`).
5. Nunca se usa la service-role key en el navegador; el aislamiento lo impone
   Postgres, no la interfaz.

`private.organizacion_id()` resuelve la única membresía del usuario, o la
organización que un superadmin entró; sin ninguna de las dos devuelve `null` y
la política no devuelve filas (fail-closed). Hoy no excluye a los usuarios
suspendidos: eso lo agrega F-ACC-01 (columna `estado`, spec de la misma épica).

## Cómo se hace cumplir

- `supabase/tests/database/rls_en_toda_tabla.test.sql` recorre el catálogo
  (`pg_class`) de `public` y `dominio` y **falla si alguna tabla no tiene RLS
  activado**. Una tabla nueva sin RLS rompe `pnpm test:db` sin tocar la prueba.
  Se omiten las particiones hijas y las tablas que pertenecen a una extensión.
- `supabase/tests/database/aislamiento_organizaciones.test.sql` verifica con
  dos organizaciones que cada administrador, miembro y superadmin ve solo lo
  suyo, y que un usuario sin membresía no ve nada.
- Revisión del build (T019): las tablas creadas en `supabase/migrations`
  habilitan RLS; ninguna tabla expuesta queda sin él.

## Qué cubre y qué no

La prueba de catálogo exige RLS activado, no que la política sea correcta: una
política `using (true)` la satisface. Por eso cada tabla de dominio nueva debe
sumar sus casos a la prueba de aislamiento (dos organizaciones, sin membresía).
