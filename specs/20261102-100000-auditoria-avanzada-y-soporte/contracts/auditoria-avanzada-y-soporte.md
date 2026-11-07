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
public.exportar_actividad(p_desde date default null, p_hasta date default null, p_empresa uuid default null, p_actor uuid default null, p_tipo text default null, p_texto text default null): { creado_en, tipo, empresa_nombre, actor_nombre, detalle, total: bigint }
```

- Mismos filtros y semántica que `listar_actividad`; security invoker; exige `private.puede_accion('actividad','exportar')` (`42501` si no); máximo 50.000 filas (`total` trae el conteo real para avisar el recorte).

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
