# Empresas: modelo, esquema y operación

Spec: `specs/20261012-140000-empresas/` (MSF-138; F-EMP-01, F-EMP-02, F-EMP-04, F-EMP-05).
Migraciones: `supabase/migrations/20261013120000_empresas.sql` y
`supabase/migrations/20261013130001_empresas_updated_at.sql`.
Pruebas: `supabase/tests/database/empresas.test.sql`, `apps/web/src/pages/empresas/{list,edit}.test.tsx`
y `apps/web/src/components/navegacion/SelectorEmpresa.test.tsx`.

Una organización tiene **N empresas** (hoy San Javucho y Mundo JC, en una única organización). Ningún código,
consulta ni prueba asume que son dos. El alta de empresas (F-EMP-03) y el aislamiento *entre* empresas
(MSF-121) quedan fuera.

## Esquema y RLS (Principio VII)

Tabla `dominio.empresas`: es una entidad de negocio (quién vende), por eso vive en `dominio` y no en `public`.

| Columna | Regla |
|---|---|
| `id` | uuid, inmutable para `authenticated`. |
| `organizacion_id` | FK a `public.organizaciones` (`on delete cascade`), inmutable; índice propio. |
| `nombre` | no vacío tras `btrim`. |
| `whatsapp`, `correo`, `instagram`, `direccion` | texto opcional. |
| `activa` | `boolean not null default true`; pausar = `false`. |
| `created_at`, `updated_at` | `updated_at` la mantiene el trigger `empresas_updated_at`. |

- RLS habilitada. `select`: `organizacion_id = private.organizacion_id()`. `update`: el mismo predicado más
  `private.puede_escribir()`, en `using` y `with check`.
- No hay política ni grant de `insert`/`delete`; `authenticated` solo puede `update` de
  `nombre, whatsapp, correo, instagram, direccion, activa`. `anon` no recibe privilegios.
- El cliente consulta con `supabaseClient.schema('dominio').from('empresas')` (`dominio` está en
  `[api] schemas` de `supabase/config.toml`); la RLS aplica igual.
- La prueba de aislamiento (pgTAP) recorre `public` + `dominio` y falla si una tabla no tiene RLS.

## Pantallas

- `/empresas` (menú, audiencia administrador): una fila por empresa con tienda web, Mercado Libre, precio,
  moneda ARS y productos visibles; «Sin configurar» donde no hay fuente. El miembro que entra por ruta directa
  ve acceso restringido.
- `/empresas/edit/:id` (General): nombre, dominio solo lectura, idioma/moneda fijos, WhatsApp, correo,
  Instagram, dirección; control Activa/Pausada de acción inmediata, independiente del formulario.
- `SelectorEmpresa`: lista las empresas de la organización, marca la actual (la toma de la ruta) y navega a la
  misma sección de la elegida; con cambios sin guardar pide confirmación. Con una sola empresa es etiqueta fija.

## Carga inicial (dato, no esquema)

La migración no inserta empresas. Para el primer cliente se cargan como dato, con el `id` de su organización:

```sql
insert into dominio.empresas (organizacion_id, nombre)
select o.id, e.nombre
from public.organizaciones o
cross join (values ('San Javucho'), ('Mundo JC')) as e(nombre)
where o.id = '<uuid-de-la-organizacion>';
```

Se ejecuta con rol propietario/servicio (`authenticated` no tiene `insert`). El esquema no impone unicidad por
nombre (N empresas por organización), así que hay que verificar antes que no existan para no duplicarlas.

## Eventos hacia F-AUD-01

`apps/web/src/lib/eventosActividad.ts` define el contrato `EventoActividad`
(`empresa.actualizada`, `empresa.pausada`, `empresa.reactivada`; actor, empresa, cambios campo a campo, fecha) y
`emitirEventoActividad`. F-AUD-01 aún no existe: sin destino registrado (`registrarDestinoActividad`) no hace
nada, y un destino que falle no revierte el guardado (solo `console.warn`). Cuando llegue F-AUD-01 se registra
su destino sin tocar a quien emite.

## Reversión

Migraciones aditivas. Revertir: `drop trigger empresas_updated_at on dominio.empresas;
drop function private.tocar_updated_at();` y `drop table dominio.empresas;`, en una migración **posterior**
(no en el mismo PR que las crea). Deshacer la spec completa: `git revert -m 1 <merge>` (deja la tabla
huérfana hasta esa migración).

## Pruebas E2E (pendiente)

El repo no tiene una suite Playwright E2E de la app (solo `infra/playwright`). Los escenarios SC-001 a SC-004
(listar, editar, pausar/reactivar, cambiar de empresa) están cubiertos por Vitest y pgTAP; los recorridos E2E
quedan como seguimiento (ver nota en `tasks.md`, T011).
