# Bug Fix: las filas «Cambio de empresa activa» no ocupan la lista de Actividad

- **Slug**: msf-985
- **Fixed**: 2026-11-18
- **Assessment**: ./assessment.md
- **Status**: applied

## Resumen

El evento `usuario.empresa_activa_cambiada` **se sigue registrando** (es trazabilidad de un cambio de contexto: la
empresa activa decide el rol con el que la persona opera en las secciones por empresa), pero **no aparece en la lista de
Actividad ni en el CSV**, salvo que se pida ese tipo explícitamente con el filtro **Tipo**. La regla vive en un único
lugar, `private.tipos_de_contexto_actividad()`, y la aplican `public.listar_actividad` y `public.exportar_actividad`, así
que el contador «N eventos», el bloque «Actividad reciente» del inicio y el archivo exportado cuentan lo mismo que la
lista.

## Cambios

| Archivo | Cambio | Notas |
|---------|--------|-------|
| `supabase/migrations/20270507200300_actividad_eventos_de_contexto.sql` | added | Helper `private.tipos_de_contexto_actividad()` y redefinición de `public.listar_actividad` y `public.exportar_actividad` (misma firma) con el filtro de los eventos de contexto. |
| `supabase/tests/database/actividad_eventos_contexto.test.sql` | added | El evento se registra, la lista no lo muestra, se ve si se pide por tipo, y el CSV sale con las mismas filas que la pantalla. |
| `docs/actividad.md` | modified | Sección «Eventos de contexto: no ocupan la lista (MSF-985)», nota en «Lectura» y ajuste del «Fuera de alcance» de MSF-618. |
| `docs/producto/actividad.md` | modified | El manual (guía de uso) dice que el cambio de empresa activa queda registrado pero no aparece en la lista, y cómo verlo. |
| `docs/empresa-activa.md` | modified | La RPC de cambio de empresa activa registra el evento, pero el evento no ocupa la lista. |
| `docs/tecnico/permisos-por-empresa.md` | modified | El contrato de `cambiar_empresa_activa` aclara que el evento no ocupa la lista. |

## Diff Highlights

```sql
-- La regla, en un solo lugar
create or replace function private.tipos_de_contexto_actividad()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['usuario.empresa_activa_cambiada'];
$$;

-- En listar_actividad y en las dos consultas de exportar_actividad
and (r.tipo <> all (private.tipos_de_contexto_actividad()) or p_tipo = r.tipo)
```

## Pruebas agregadas o actualizadas

- `supabase/tests/database/actividad_eventos_contexto.test.sql::el cambio de empresa activa se sigue registrando en el
  historial` — el evento se sigue escribiendo en la misma transacción que el cambio.
- `…::la fila de cambio de empresa activa no ocupa la lista` — el listado no la trae y el `total` no la cuenta.
- `…::la fila de contexto se ve si se pide ese tipo` — con `p_tipo` (y combinando otros filtros) la fila aparece.
- `…::el tipo de contexto sigue en las opciones del filtro «Tipo»` — el tipo sigue siendo alcanzable desde la pantalla.
- `…::el CSV no incluye la fila de contexto` / `…::el CSV incluye la fila de contexto si se pide ese tipo` — el archivo
  exportado sale con las mismas filas que la pantalla (FR-013).

## Verificación local

- Postgres 17 local con las migraciones del repo aplicadas (`20270507200300_actividad_eventos_de_contexto.sql` incluida)
  y pgTAP: `node /tmp/opencode/pgtest/pgtap.mjs supabase/tests/database/actividad_eventos_contexto` → 13 pruebas en
  verde.
- **Prueba que vigila la regla**: se recrearon `listar_actividad` y `exportar_actividad` como estaban antes (sin la línea
  de contexto) y el mismo archivo falló 5 de sus 13 aserciones (las que miden la regla); con la migración aplicada, las 13
  pasan.
- `pnpm lint`, `pnpm build` y `pnpm docs:check` → en verde (ver el informe de la corrida).
- Los pgTAP del resto de la suite (`supabase/tests/database/*.sql`) se corrieron contra el Postgres local: los de
  actividad (`registro_actividad`, `exportar_actividad`, `actividad_por_empresa`, `depurar_registro_actividad`,
  `cuentas_cliente_actividad`, `clientes_exportar_actividad`, `procesos_masivos_reporte_actividad`,
  `acceso_soporte_actividad`) pasan sin cambios.

## Desviaciones de la evaluación

- La evaluación proponía la exclusión en `listar_actividad` y `exportar_actividad`; se hizo exactamente eso, pero con el
  filtro agregado a las **dos** consultas del export (el conteo del filtro y la página por cursor): si solo se filtrara
  la página, el «N» del archivo y el total del listado no coincidirían con las filas entregadas.
- No se tocó la interfaz: el filtro **Tipo** que ya existe alcanza para pedir las filas de contexto, así que la pantalla
  no cambia (y el prototipo manda: `design/pantallas/Actividad.dc.html` no se modifica).

## Seguimientos

- **MSF-604** (ya abierto, con dueño): la descripción de la pantalla («Historial básico: …») ya no describe todo lo que
  muestra la lista. Queda fuera de este cambio, que es de comportamiento del listado.
