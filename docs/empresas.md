# Empresas: datos generales y estado de la tienda

Spec: `specs/20261012-140000-empresas/` (épica MSF-138, F-EMP-01/02/04/05).
Migraciones: `supabase/migrations/20261013120000_empresas.sql` y
`20261013130001_empresas_updated_at.sql`.
Pruebas: `supabase/tests/database/empresas.test.sql`, `apps/web/src/pages/empresas/{list,edit}.test.tsx`.

Una **empresa** es quien vende (su precio, su tienda web y sus cuentas de Mercado Libre); el
producto, el stock y la cotización son de la organización. Una organización puede tener **1..N**
empresas: en el lanzamiento el primer cliente tiene dos (San Javucho y Mundo JC), pero **ningún
código, consulta, constraint ni prueba asume que son exactamente dos** (FR-003). El aislamiento
*entre* empresas lo agrega MSF-121; hasta entonces los usuarios de la organización ven todas las
de su organización.

## Esquema y RLS (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `empresas` | **`dominio`** | Entidad de negocio del producto (quién vende), no mecanismo de plataforma. | Sí, por organización (ver abajo). |

Columnas: `id`, `organizacion_id` (FK a `public.organizaciones`, `on delete cascade`), `nombre`
(no vacío tras `btrim`), `whatsapp`, `correo`, `instagram`, `direccion`, `activa` (default `true`),
`created_at`, `updated_at`. Índice por `organizacion_id`.

Políticas (migración `20261013120000`):

- `empresas_select`: `for select to authenticated` con `organizacion_id = private.organizacion_id()`.
- `empresas_update`: `for update to authenticated` con `organizacion_id = private.organizacion_id()
  and private.puede_escribir()`, en `using` y `with check`.
- **Sin política INSERT/DELETE**: crear empresas es F-EMP-03 (MSF-475, Etapa 2); borrar no está en la spec.
- Grants: `usage` de `dominio` y `select` a `authenticated`; `update` **solo** sobre las columnas
  editables (`nombre`, `whatsapp`, `correo`, `instagram`, `direccion`, `activa`) — `id`,
  `organizacion_id` y `created_at` quedan inmutables para el rol.
- `updated_at` se mantiene sola con el trigger `empresas_updated_at` (función
  `private.tocar_updated_at()`, migración `20261013130001`), para que pausar/reactivar deje la marca.

## Pantallas

- `/empresas` (listado): una fila (o tarjeta en pantallas angostas) por empresa con nombre, tienda
  web, Mercado Libre, precio, moneda y productos visibles; lo que aún no alimenta ninguna épica
  muestra «Sin configurar». Sin botón de alta.
- `/empresas/edit/:id` (General): nombre, dominio solo lectura, idioma «Español (Argentina)» y
  moneda «ARS» fijos, WhatsApp, correo, Instagram, dirección opcional. Validación (nombre
  obligatorio, formato de correo), aviso de cambios sin guardar y estados de carga/error/éxito.
- Activar/pausar es una acción inmediata e independiente del formulario; el listado muestra el estado.

## Carga inicial (San Javucho y Mundo JC) — dato, no esquema

La carga inicial es **dato de la organización del primer cliente**, no parte de la migración. Se
inserta con la organización real (por ejemplo, vía SQL o el seed del entorno) — nunca en el código:

```sql
-- Reemplazar <organizacion_id> por la organización real (uuid).
insert into dominio.empresas (organizacion_id, nombre, correo)
values
  ('<organizacion_id>', 'San Javucho', null),
  ('<organizacion_id>', 'Mundo JC', null);
```

Las pruebas insertan sus propias filas (1, 2 y 3 por organización) para no asumir cantidad.

## Actividad hacia F-AUD-01 (FR-010)

`apps/web/src/lib/eventosActividad.ts` define el contrato y el punto de emisión; F-AUD-01 todavía no
existe, así que sin destino registrado no hace nada. Eventos emitidos desde la pantalla:

| Evento | Cuándo | Cambios |
|---|---|---|
| `empresa.actualizada` | Guardar «General» | Campos modificados (`antes`/`despues`). |
| `empresa.pausada` | Pausar la tienda | `activa` `true` → `false`. |
| `empresa.reactivada` | Reactivar la tienda | `activa` `false` → `true`. |

La actividad es secundaria al guardado: un destino que falle **no** revierte la edición ya
persistida (queda `console.warn`). Cuando F-AUD-01 llegue, registra su destino con
`registrarDestinoActividad` y no hay que tocar a quien emite.

## Reversión

Migración aditiva (tabla nueva). Revertir en una migración **posterior** (no en el mismo PR):

```sql
drop trigger if exists empresas_updated_at on dominio.empresas;
drop function if exists private.tocar_updated_at();
drop table if exists dominio.empresas;
```

Deshacer la spec completa: `git revert -m 1 <merge>`.

## Límites conocidos

- Sin E2E automatizado: el repo no tiene suite Playwright de la app (solo `infra/playwright`);
  listado, edición y pausa/reactivación están cubiertos por Vitest y pgTAP (tareas T011/T017/T021/T025
  con nota de desvío). La capacidad «E2E en CI» está en el roadmap del template (#7).
- El aislamiento entre empresas es de MSF-121; acá todos los usuarios de la organización ven todas
  las empresas de su organización.
- Borrar una organización borra en cascada sus empresas; no hay papelera (roadmap #33).
