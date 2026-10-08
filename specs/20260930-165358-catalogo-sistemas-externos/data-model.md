# Data Model: Catálogo real para sistema_externo en conexiones

La migración abre con un comentario de reversión: reversión = (en orden
inverso a como se crea) `alter table conexiones drop constraint
conexiones_sistema_externo_fkey;` y `drop table sistemas_externos;` — sin
tocar la columna `conexiones.sistema_externo` en sí (se conserva tal cual,
`text not null`) ni ninguna otra tabla de spec 013. Sin dependencias de
ninguna otra spec posterior (nada referencia `sistemas_externos` todavía).

## Entidad nueva: `sistemas_externos`

Catálogo de plataforma, mismo patrón que `roles_organizacion`
(`20260908172920_fundacion_multitenant.sql`, líneas 13-19): "agregar un
sistema externo es una fila nueva, no un check fijo".

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `text` | PK — slug estable, es el valor que usa `conexiones.sistema_externo` |
| `descripcion` | `text` | `not null` — texto libre |

Sin `organizacion_id`: es un catálogo de plataforma, no un dato de una
organización (igual criterio que `roles_organizacion`).

**Se crea vacía.** Cero `insert` en esta migración (FR-002 de `spec.md`) —
cargar valores reales (nombres de sistemas externos de negocio) es
responsabilidad de cada producto derivado, en su propia migración de carga,
después de hacer `git merge upstream/main` de esta spec.

**RLS**: habilitado. Una sola policy:

```sql
create policy sistemas_externos_select on sistemas_externos
  for select to authenticated
  using (true);
```

Sin policy de `insert`/`update`/`delete` — el alta de valores queda fuera de
alcance de esta spec (spec.md, Assumptions), mismo estado que
`roles_organizacion` hoy (que tampoco tiene policy de escritura ni pantalla
propia en este template).

**Grants** (`auto_expose_new_tables = false`, igual que el resto del
esquema):

```sql
grant select on sistemas_externos to authenticated;
```

## Entidad modificada: `conexiones` (spec 013)

Sin cambio de forma. Se agrega una constraint nueva sobre la columna
existente:

```sql
alter table conexiones
  add constraint conexiones_sistema_externo_fkey
  foreign key (sistema_externo) references sistemas_externos (id)
  not valid;
```

`not valid` (ver `research.md`, R2): no escanea ni bloquea por filas
preexistentes de `conexiones` que no resuelvan contra el catálogo (vacío al
momento de esta migración) — sí aplica a toda escritura nueva sobre
`sistema_externo` desde que se crea la constraint en adelante, sea vía
`public.crear_conexion` o vía `insert` directo (como hacen varios tests
pgTAP, ver `plan.md`).

`conexiones.sistema_externo` conserva su tipo (`text`) y su `not null`
actuales — no se toca la columna, solo se le agrega la FK.

## Efecto en consumidores existentes (sin cambio de firma)

- `public.crear_conexion(uuid, text, text)`: mismo contrato
  (`specs/013-orquestacion-multi-organizacion/contracts/gestion-conexiones-y-servidores.md`),
  ahora puede fallar con `23503` (foreign_key_violation) si el
  `sistema_externo` pedido no existe en el catálogo — comportamiento nuevo
  esperado (User Story 1, SC-001), no un cambio de contrato.
- `private.datos_despacho_conexion`, `private.organizaciones_activas_para_conector`:
  sin cambio — siguen recibiendo `sistema_externo` como `text`, ahora
  garantizado por FK a ser un valor del catálogo para cualquier fila nueva.
- `excepciones_flow_generico.conector_id`: sin cambio — fuera de alcance
  (spec.md, Edge Cases).
