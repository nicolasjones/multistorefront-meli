# Contract: RPC `entrar_a_organizacion`

> **Reemplazado (F-OPS-04, MSF-300):** la firma `entrar_a_organizacion(org_id)` ya no existe.
> Ahora es `entrar_a_organizacion(org_id uuid, p_motivo text)`: el motivo es obligatorio, el
> acceso vence a las 4 h y se registra como `soporte.*` en la actividad de la organización.
> Ver `docs/acceso-soporte.md` y `specs/20261102-100000-auditoria-avanzada-y-soporte/contracts/`.

**Quién la llama**: Refine, desde el botón "Ingresar" en cada fila del
listado de organizaciones (Historia 4), solo accesible a superadmin.

## Request

Llamada RPC de PostgREST (vía `@refinedev/supabase` / `supabase-js`):

```ts
supabase.rpc('entrar_a_organizacion', { org_id: '<uuid>' })
```

## Comportamiento (dentro de la función, `security definer`)

1. Verifica `private.is_superadmin()`. Si es falso, `raise exception` (→ 403
   desde PostgREST).
2. `upsert` en `superadmin_organizacion_activa` (`user_id` = `auth.uid()`,
   `organizacion_id` = `org_id`, `entrado_en` = `now()`) — reemplaza
   cualquier organización activa anterior (una a la vez, FR-006).
3. `insert` en `superadmin_entradas` con los mismos datos — nunca se
   pisa, es el historial (FR-013).

Ambos pasos ocurren en la misma transacción de la función — si el paso 2
falla, no queda un registro de auditoría sin el cambio de contexto real, y
viceversa.

## Response

Sin cuerpo (`void`) en éxito — el frontend redirige a las pantallas de
`clientes` después de la llamada exitosa. Error (excepción) si quien llama
no es superadmin o `org_id` no existe.
