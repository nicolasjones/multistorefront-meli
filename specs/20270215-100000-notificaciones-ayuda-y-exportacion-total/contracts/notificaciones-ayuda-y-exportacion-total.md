# Contratos: Notificaciones, ayuda y exportación total

Todos nuevos (sin `BREAKING`). No hay Edge Functions nuevas (no aplica OpenAPI). La ayuda (F-CFG-02) no crea contratos de base de datos.

## F-NOT-02 (esquema `public`)

Alteración aditiva: `public.avisos_pendientes.leido_en timestamptz null` + índice `(user_id, creado_en desc)`. Sin cambios de RLS ni de privilegios.

```ts
listar_notificaciones(p_limite?: int = 20, p_antes_de?: timestamptz): { total: int, items: { id: uuid, tipo_nombre: text, datos: jsonb, creado_en: timestamptz, leido_en: timestamptz | null }[] }
contar_notificaciones_sin_leer(): int
marcar_notificaciones_leidas(p_ids?: uuid[]): int   // cantidad marcada; p_ids nulo = todas las propias sin leer
```

`security definer`, `search_path = ''`. Persona y organización salen de `auth.uid()` / `private.organizacion_id()`; no se reciben por parámetro. Excluyen `estado = 'descartado'` y tipos sin acceso vigente (`private.nivel_seccion_de_usuario`). `p_limite` se acota (máximo 50). `revoke … from public, anon`; `grant execute … to authenticated`.

## F-OPS-06 (esquema `public` / `private`)

```ts
solicitar_exportacion_total(): { proceso_id: uuid, ejecucion_id: uuid, estado: string, reutilizado: boolean }
```
`security definer`. Solo administradores de la organización de la sesión. Registra el proceso con `iniciar_proceso_masivo` (tipo `exportacion`, funcionalidad `exportacion_total`) y su orden en la misma transacción; si hay una `pendiente`/`en_curso`, la devuelve con `reutilizado = true`. Errores: `NO_AUTORIZADO`, `SIN_CONEXION_EXPORTACION`. `revoke … from public, anon`; `grant execute … to authenticated`.

```ts
private.conjuntos_exportacion_total(): { esquema: text, tabla: text, columnas: text[] }[]
private.datos_exportacion_total(p_ejecucion_id: uuid): { organizacion_id: uuid, proceso_id: uuid, conjuntos: int }
private.filas_exportacion_total(p_ejecucion_id: uuid, p_esquema: text, p_tabla: text, p_desde: int, p_limite: int): jsonb[]
```
Solo el rol `worker_<org>` (miembro de `workers_orquestacion`); verifican que la ejecución sea de la capacidad `exportar-organizacion-*` y esté en curso, y filtran por la `organizacion_id` de la ejecución. `revoke` a todos los demás roles, incluido `authenticated` y `anon`.

## Storage

Bucket privado `exportaciones-organizacion`; objeto `<organizacion_id>/<ejecucion_id>.zip`. Política `select` para `authenticated` solo si es administrador de esa organización. Sin política de insert/update/delete para `authenticated` (escribe el worker con la clave de servicio del servidor).

## Kestra y variables

- Flow nuevo `exportar-organizacion` (namespace `platform.exportacion`) que consume `private.reclamar_despachos_capacidad('exportar-organizacion-', …)`; no cambia el subflow `alertas`.
- Variables nuevas solo en `.env.example` (sin secretos en Git).
