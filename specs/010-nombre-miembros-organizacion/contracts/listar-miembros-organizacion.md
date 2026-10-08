# Contract: RPC `listar_miembros_organizacion`

**Quién la llama**: Refine, desde la pantalla de miembros
(`apps/web/src/pages/miembros/list.tsx`), exclusiva de quien administra
membresías — administrador o superadmin con organización activa
(`accessControlProvider.ts` ya restringe el recurso `'miembros'` a ese
público, sin cambios en esta spec). Reemplaza el `useTable` actual sobre
`usuarios_organizacion` como fuente de datos de esa pantalla.

## Request

Llamada RPC de PostgREST (vía `@supabase/supabase-js`), sin parámetros:

```ts
supabase.rpc('listar_miembros_organizacion')
```

## Permisos

`grant execute on function public.listar_miembros_organizacion() to authenticated;`
— mismo patrón que `entrar_a_organizacion` / `salir_de_organizacion`. Sin
este grant, la llamada falla con `permission denied` antes de evaluar nada.

## Comportamiento (dentro de la función, `security definer`, `stable`)

1. Resuelve `v_organizacion_id := private.organizacion_id()` — la
   organización del llamador (su única membresía, o la organización activa
   si es superadmin).
2. Si `v_organizacion_id` es `null` (no pertenece a ninguna organización y
   no es superadmin con una activa), devuelve un conjunto vacío — no es un
   error; la pantalla ya está protegida por `RequiereOrganizacionActiva` en
   el frontend, esta función solo evita filtrar nada si igual se la llama.
3. Si `not private.puede_gestionar_membresias(v_organizacion_id)`, devuelve
   igualmente un conjunto vacío. Esta función es `security definer` y su
   `grant execute` es amplio (`to authenticated`, ver Permisos) — el gateo
   por rol de `accessControlProvider.ts` en el frontend es solo UX (oculta
   el ítem de menú), no un control de seguridad; sin este chequeo interno,
   cualquier persona autenticada de la organización podría llamar la RPC
   directo y leer nombre/apellido de sus compañeros aunque no administre
   membresías, violando el alcance acordado en Clarifications de spec 010.
4. Si pasa ambos chequeos, devuelve, para cada fila de
   `usuarios_organizacion` con `organizacion_id = v_organizacion_id`, un
   `left join` a `perfiles_usuario` por `user_id`: `(user_id, rol_id,
   created_at, nombre, apellido)`. El `left join` es obligatorio — una
   persona sin fila en `perfiles_usuario` (perfil nunca guardado) debe
   seguir apareciendo en el listado con `nombre`/`apellido` en `null`,
   nunca desaparecer de la lista (FR-004).

No modifica ningún dato; no genera evento de auditoría (es lectura pura,
igual que el `select` directo que ya hacía `useTable`).

## Response

```ts
type MiembroOrganizacion = {
  user_id: string
  rol_id: string
  created_at: string
  nombre: string | null
  apellido: string | null
}
// supabase.rpc(...) -> { data: MiembroOrganizacion[], error }
```

Sin filas si el llamador no tiene organización efectiva. Nunca lanza
excepción por falta de organización — solo por error de conexión/DB, igual
que cualquier otra consulta.

## Casos cubiertos (trazabilidad a la spec)

| Caso | FR/Escenario | Cómo lo cubre |
|------|--------------|----------------|
| Administrador ve nombre de compañero | FR-001, Acceptance Scenario 1 | La función expone `nombre`/`apellido` de toda fila de la organización efectiva solo cuando el llamador cumple `puede_gestionar_membresias`. |
| Un miembro raso no puede leer nombres llamando la RPC directo | FR-001 (alcance acordado en Clarifications) | El chequeo interno de `puede_gestionar_membresias` devuelve conjunto vacío — el control no depende solo de que el frontend oculte el menú. |
| Aislamiento entre organizaciones | FR-002, Acceptance Scenario 2 | El filtro `organizacion_id = private.organizacion_id()` excluye toda fila de otra organización; no hay parámetro que un cliente pueda manipular para pedir otra organización. |
| Perfil incompleto | FR-004, Acceptance Scenario 3 | `left join` conserva la fila con `nombre`/`apellido = null`; la UI decide el texto de fallback (ver `data-model.md`). |
| Ningún otro campo de `perfiles_usuario` cambia de regla | FR-005 | La función selecciona explícitamente solo `nombre, apellido`; no hay `select *` ni se agrega `foto_path`. |
| Superadmin en organización activa | FR-006 | `private.organizacion_id()` ya resuelve ese caso (spec 003/004); sin lógica adicional en esta función. |
| Persona removida deja de verse | FR-007 | Al perder su fila en `usuarios_organizacion` para esa organización, el `join` deja de producir esa fila en el resultado. |
