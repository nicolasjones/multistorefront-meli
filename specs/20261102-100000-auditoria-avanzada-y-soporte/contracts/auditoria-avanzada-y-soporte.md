# Contratos — Plataforma · Auditoría avanzada y soporte

Todas las RPC de `public` llevan `revoke execute ... from public, anon` y `grant execute ... to authenticated` explícitos en su migración. Las funciones de `private` no son ejecutables por `authenticated`. No hay Edge Functions (sin `openapi/`).

## F-AUD-02

```ts
private.registrar_cambio_actividad(p_tipo text, p_detalle text, p_valor_anterior jsonb, p_valor_nuevo jsonb, p_empresa_id uuid default null): uuid
private.insertar_cambio_actividad(p_organizacion_id uuid, p_actor_id uuid, p_tipo text, p_detalle text, p_valor_anterior jsonb, p_valor_nuevo jsonb, p_empresa_id uuid default null): uuid
```

- Organización y actor salen de la sesión en `registrar_cambio_actividad`. Si el tipo es `sensible`, ambos valores son objetos jsonb obligatorios (`22023` si faltan o superan 8 KB).
- `private.insertar_actividad(uuid, uuid, text, text, uuid)` y `private.registrar_actividad(text, text, uuid)` conservan su firma; ahora rechazan (`22023`) los tipos sensibles.

```ts
public.obtener_detalle_actividad(p_id uuid): { id, creado_en, tipo, empresa_id, empresa_nombre, actor_id, actor_nombre, detalle, sensible: boolean, valor_anterior: jsonb | null, valor_nuevo: jsonb | null }
```

- Security invoker (rige la RLS de `registro_actividad`); devuelve 0 filas si no es de la organización o sin permiso.

```ts
private.depurar_registro_actividad(p_hasta timestamptz default now()): integer
```

- Borra eventos con más de 24 meses respecto de `p_hasta`; solo `workers_orquestacion`; devuelve la cantidad borrada y registra `sistema.depurada` por organización.

## F-AUD-03

```ts
public.exportar_actividad(p_desde, p_hasta, p_empresa, p_actor, p_tipo, p_texto, p_corte, p_cursor_creado_en, p_cursor_id, p_limite, p_entregadas /* ignorado */, p_exportacion uuid, p_con_total boolean): { filas, total, tope, recortado, corte, hay_mas, siguiente, exportacion }
```

- Mismos filtros y semántica que `listar_actividad`; security definer; exige `private.puede_accion('actividad','exportar')` **y** nivel `edicion` en `actividad` (por defecto solo el Administrador; `42501` si no).
- Lotes por cursor `(creado_en, id)`, máximo 50.000 filas por exportación; el conteo y el tope los lleva el servidor (`p_entregadas` se ignora). `total` trae el conteo real para avisar el recorte.
- La constancia `actividad.exportada` se registra en la **primera** llamada de cada `p_exportacion` (filtros + total) y el id se cierra al entregar la última fila o llegar al tope; reutilizar un id cerrado, incluido el reintento de la última página, devuelve `22023`.

## F-OPS-04

```ts
public.entrar_a_organizacion(org_id uuid, p_motivo text): void
```

BREAKING: reemplaza a `entrar_a_organizacion(org_id uuid)`; el motivo es obligatorio (no vacío, ≤ 500) para que el ingreso de soporte quede siempre justificado y no exista una vía sin motivo. Se actualizan en el mismo PR la UI (`pages/organizaciones/list.tsx`), los pgTAP y `specs/003-…/contracts/entrar-a-organizacion.md` (nota de reemplazo).

```ts
public.salir_de_organizacion(): void
```

- Firma sin cambios. Además registra `soporte.salida` (o `soporte.vencido` si el acceso ya había vencido).

Reversión (documentada en el encabezado de cada migración): restaurar la versión de una sola arg y `drop column motivo / vence_en`, restaurar los helpers de organización activa; los eventos ya escritos se conservan.
