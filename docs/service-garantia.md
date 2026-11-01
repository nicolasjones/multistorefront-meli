# Service técnico · Reingreso por garantía (F-SVC-21)

Historia **MSF-146**, épica **MSF-124** · spec en `specs/20261028-100000-service-seguimiento-y-reportes/`
(User Story 2, FR-020 a FR-026). Permite volver a ingressar un equipo que vuelve por garantía, dejando
constancia del vínculo entre la reparación entregada y la nueva.

## Qué ve la persona del taller

En `/service-tecnico/reparaciones/:id`, el botón **«Reingresar por garantía»** aparece solo con `edicion`
en `service_tecnico` y con la reparación **entregada** y **no anulada**. Abre un diálogo con:

- El **resumen del equipo en solo lectura** (reparación, cliente, equipo y modelo, N.º de serie y accesorios).
- **«Falla del reingreso»**, obligatoria: describe por qué vuelve el equipo.
- **«Técnico»** y **«Entrega prevista»**, opcionales.
- «Cancelar» y «Reingresar». Los errores de la base se muestran en el campo correspondiente.

Al guardar, la pantalla lleva al detalle de la reparación nueva. Si la persona cambia de empresa en la barra
superior con el diálogo abierto, el diálogo **se cierra con aviso** (Principio VIII): el reingreso hereda la
tienda de la original y nunca la cambia.

En el detalle de cada reparación aparece la sección **«Garantía»** (carga diferida): en el reingreso, el texto
«Reingreso por garantía de R-xxxx» con enlace a la original; en la original, la lista de sus reingresos con
código, estado e ingreso, cada uno con enlace. Una reparación sin vínculos no muestra la sección.

## Regla de negocio

- Solo se reingresa una reparación **entregada** (`entrega_real`) y **no anulada**. La base lo rechaza con
  `55000`; la interfaz no ofrece el botón.
- El reingreso crea una **reparación nueva** y la vincula con `reparacion_origen_id`. **No** copia ítems,
  costos ni adjuntos: la nueva nace sin ítems y con los costos en cero. La regla de «sin cargo» y el plazo de
  garantía quedan para MSF-232 (*Decisiones abiertas* 3 de la spec).
- Se permiten **varios reingresos de la misma original** y **reingresar desde un reingreso** entregado: el
  vínculo apunta al origen inmediato.
- La nueva hereda **tienda, cliente, contacto, modelo, N.º de serie y accesorios**; la **falla** es la nueva.
- La nueva toma el **siguiente número de la tienda** (`R-xxxx`), el **primer estado activo** por `orden` y el
  **ingreso de hoy** (zona Argentina), y queda con el evento `alta` del historial y la nota
  «Reingreso por garantía de R-xxxx».
- El **técnico** tiene que ser elegible (`tecnicos_de_service`) y la **entrega prevista** no puede ser anterior
  al ingreso.

## Modelo de datos

Esquema (Constitución, Principio VII): no hay tablas nuevas. La columna `reparacion_origen_id` vive en
`dominio.reparaciones` (entidad de negocio del taller → `dominio`).

| Objeto | Migración | Notas |
|---|---|---|
| `dominio.reparaciones.reparacion_origen_id` | `20270122150100` | Nullable. FK compuesta `(reparacion_origen_id, organizacion_id)` a `reparaciones (id, organizacion_id)`, `check (reparacion_origen_id <> id)` e índice parcial. `grant select` por columna a `authenticated`; **sin** `insert`/`update` directos. |
| `public.reingresar_por_garantia` | `20270122150200` | `security definer`, `search_path = ''`. Exige `edicion`; origen de la organización y de una tienda accesible (`P0002` si no existe, `42501` si la tienda no es accesible); entregada y no anulada (`55000`); falla no vacía (`22023`, `hint = falla`); técnico elegible (`22023`, `hint = tecnico`); entrega prevista ≥ ingreso (`22023`, `hint = entrega_prevista`). Bloquea el origen con `for update` y toma el número con el bloqueo de numeración vigente. Actividad `reparacion.reingreso_garantia`. |
| `public.obtener_vinculos_garantia` | `20270122150300` | `security definer`, `search_path = ''`. Acepta `lectura` o `edicion`; solo tiendas accesibles (una tienda inaccesible se trata como inexistente, `P0002`). Devuelve `{ origen: {id, codigo} \| null, reingresos: [{id, codigo, estado, ingreso}] }`. |

Las dos RPC llevan `revoke execute … from public, anon` y `grant execute … to authenticated`; `anon` no las
ejecuta. No reemplazan `crear_reparacion` ni `obtener_reparacion`: son una RPC y una columna nuevas.

## Numeración sin repetidos ni saltos

La numeración es la de MSF-182: `private.siguiente_numero_reparacion` toma el advisory lock por empresa
(`pg_advisory_xact_lock`) y deriva el número del máximo existente. Dos reingresos simultáneos de la misma
tienda se serializan, así que no hay repetidos ni saltos (FR-025). La concurrencia real no cabe en una
transacción de pgTAP: el test verifica la serie completa de la tienda y que el número se tome bajo el bloqueo.

## Pruebas

- pgTAP `supabase/tests/database/service_garantia.test.sql` (SC-004): columna y FK compuesta, `check`, sin
  escritura directa, copia de datos, número siguiente, primer estado activo, ingreso de hoy, historial y
  actividad, falla obligatoria, varios reingresos, reingreso de un reingreso, vínculos, aislamiento entre dos
  organizaciones y por tienda, `anon` sin ejecución y RLS en toda tabla.
- Vitest `ReingresoGarantiaDialog.test.tsx`, `VinculosGarantia.test.tsx`, `lib/reparacionGarantia.test.ts` y
  `pages/service-tecnico/reparacion-garantia.test.tsx` (SC-005): falla obligatoria, resumen en solo lectura,
  errores de la base en el campo, navegación a la nueva, cierre al cambiar de empresa, vínculos en ambas
  reparaciones y botón oculto con `lectura`, sin entrega o con la reparación anulada.

## Reversión

Las migraciones son aditivas. Para deshacerlas (migración posterior; exportar antes los vínculos):

```sql
drop function public.obtener_vinculos_garantia(uuid);
drop function public.reingresar_por_garantia(uuid, text, uuid, date);
drop index dominio.reparaciones_origen_idx;
alter table dominio.reparaciones drop constraint reparaciones_origen_distinta_check;
alter table dominio.reparaciones drop constraint reparaciones_origen_fk;
alter table dominio.reparaciones drop column reparacion_origen_id;
```

Las reparaciones creadas por reingreso **no se borran** (el modelo no borra reparaciones: se anulan); al quitar
la columna se pierde el vínculo, no el historial. En la aplicación, revertir el merge del PR de la historia
quita el botón, el diálogo y los vínculos sin afectar al resto del detalle.
