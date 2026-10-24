# Contratos: Mercado Libre · Ml conexión de cuentas

Todas las RPC viven en `public`, llevan `revoke execute ... from public, anon` y `grant execute ... to authenticated` explícito en su migración, y exigen `private.nivel_seccion('mercado_libre')` (`lectura` o `edicion` para listar, `edicion` para escribir; `42501` si no). Ninguna devuelve tokens ni secretos. Todo lo nuevo; no hay cambios de firma de algo existente (sin `BREAKING`).

## F-MLC-01 · Conectar una cuenta

```ts
iniciar_conexion_cuenta_canal(
  p_empresas uuid[],            // 1+ empresas de la organización
  p_canal text default 'mercado_libre'
) returns { cuenta_id: uuid, estado: 'pendiente' | 'autorizada' | 'requiere_reautorizacion' | 'desconectada' }
```

Crea la cuenta `pendiente` con sus empresas. `22023` si no hay empresas o alguna es de otra organización.

```ts
confirmar_conexion_cuenta_canal(
  p_cuenta uuid,
  p_nango_connection_id text,
  p_usuario_externo text,       // id de usuario de Mercado Libre, leído server-side
  p_apodo text,
  p_vence_en timestamptz
) returns void
```

Solo la invoca la Edge Function `confirmar-conexion-canal` (rol de servicio; `revoke` también de `authenticated`). Idempotente por `(organizacion_id, canal, usuario_externo_id)`: si ya existe esa cuenta, reutiliza su fila y descarta la `pendiente`. Con cuenta previa y usuario distinto → rechazo (reautorización con otra cuenta).

```ts
// Edge Function iniciar-sesion-canal     POST { cuenta_id }                          -> { token_sesion, proveedor }
// Edge Function confirmar-conexion-canal POST { cuenta_id, nango_connection_id }     -> { cuenta_id, apodo, estado }
```

Ambas autentican como el propio usuario (nunca service-role en el navegador); la clave de Nango vive solo en el servidor.

## F-MLC-02 · Listado

```ts
listar_cuentas_canal() returns {
  cuenta_id: uuid, canal: 'mercado_libre', apodo: text, usuario_externo: text,
  empresas: { id: uuid, nombre: text }[],
  estado: 'autorizada' | 'requiere_reautorizacion' | 'desconectada',   // 'pendiente' no se lista
  vence_en: timestamptz | null, ultima_renovacion_en: timestamptz | null
}[]
```

## F-MLC-03 · Reautorizar y desconectar

```ts
desconectar_cuenta_canal(p_cuenta uuid) returns void
```

Pasa a `desconectada`, conserva fila y empresas. La revocación en Nango la hace la Edge Function `desconectar-cuenta-canal` (`POST { cuenta_id }`) antes de llamar a la RPC. Reautorizar reutiliza `iniciar-sesion-canal` y `confirmar-conexion-canal` con una cuenta existente.

## F-MLC-04 · Renovación

```ts
registrar_renovacion_cuenta_canal(
  p_cuenta uuid,
  p_resultado text,             // 'renovada' | 'rechazada'
  p_vence_en timestamptz default null,
  p_motivo text default null    // sanitizado: nunca token ni respuesta cruda
) returns void
```

Invocable solo por el rol de orquestación/worker (no por `authenticated` de usuarios). `renovada` actualiza `vence_en` y `ultima_renovacion_en`; `rechazada` cuenta el intento y, agotados los reintentos, deja `requiere_reautorizacion`. Registra actividad `mercado_libre.autorizacion_renovada` / `mercado_libre.autorizacion_fallida`.

## F-MLC-05 · Empresas de una cuenta

```ts
asignar_empresas_cuenta_canal(p_cuenta uuid, p_empresas uuid[]) returns void
```

Reemplaza el conjunto de empresas. `22023` si queda vacío para una cuenta conectada o si hay empresas de otra organización. Registra `mercado_libre.empresas_asignadas`.
