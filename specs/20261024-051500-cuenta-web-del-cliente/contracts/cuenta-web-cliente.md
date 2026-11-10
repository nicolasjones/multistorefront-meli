# Contratos · Cuenta web del cliente (MSF-237)

Todo es **nuevo y aditivo**: no cambia la firma ni el resultado de nada existente. No hay `BREAKING`.
`public.guardar_empresas_de_cliente`, `public.escala_de_cliente` y `private.precio_para` se **reutilizan sin cambios**.

Reglas comunes: toda función de `public` que llama la app lleva `revoke execute … from public, anon` y
`grant execute … to authenticated` explícitos (pgTAP de superficie de `anon`). Las de `publico` filtran por el
`host` normalizado (`private.normalizar_host`) y `empresa.activa`; host desconocido y empresa desactivada devuelven
**lo mismo** (`null`). Nunca devuelven `organizacion_id`, costos, existencias ni datos de otro cliente.

## RPC del panel (`public`)

| Historia | Función |
|---|---|
| F-CLI-05 | `public.preparar_cuenta_cliente(p_cliente uuid, p_empresa uuid) returns table(correo text, dominio text, auth_user_id uuid)` |
| F-CLI-05 | `public.vincular_cuenta_cliente(p_cliente uuid, p_empresa uuid, p_auth_user uuid) returns uuid` (solo `service_role`) |
| F-CLI-05 | `public.cambiar_estado_cuenta_cliente(p_cliente uuid, p_empresa uuid, p_estado text) returns void` |
| F-CLI-05 | `public.cuentas_web_de_cliente(p_cliente uuid) returns table(empresa_id uuid, estado text, correo text, ultimo_ingreso timestamptz)` |

```ts
public.preparar_cuenta_cliente(p_cliente: string, p_empresa: string): { correo: string; dominio: string; auth_user_id: string | null }
public.vincular_cuenta_cliente(p_cliente: string, p_empresa: string, p_auth_user: string): string
public.cambiar_estado_cuenta_cliente(p_cliente: string, p_empresa: string, p_estado: 'activa' | 'suspendida'): void
public.cuentas_web_de_cliente(p_cliente: string): Array<{ empresa_id: string; estado: 'activa' | 'suspendida'; correo: string; ultimo_ingreso: string | null }>
```

- `preparar_…` (`security invoker`, llamada con el JWT del operador): exige edición de la sección Clientes, cliente y empresa de la organización, cliente habilitado en la empresa y con correo (`42501` / `22023`); devuelve el dominio de la tienda para la redirección. No escribe.
- `vincular_…`: upsert idempotente de `(cliente, empresa)` en estado `activa` y registro del evento de Actividad.
- `cambiar_estado_…`: idempotente; registra el evento (`suspendida` / `reactivada`).
- `cuentas_web_de_cliente`: lectura para la ficha y el listado; `ultimo_ingreso` sale de `auth.users`. `security definer` con `search_path = ''`, valida organización y sección Clientes.

## Edge Functions

```ts
POST invitar-cliente { cliente_id: string; empresa_id: string; accion?: 'crear' | 'restablecer' }  // JWT del operador
  -> 200 { ok: true } | 400 | 403 | 409 (mensajes controlados; sin texto de Postgres)
POST recuperar-clave-cliente { host: string; correo: string }                                      // anónima
  -> 200 { ok: true }   // SIEMPRE igual, exista o no la cuenta
```

- `invitar-cliente`: no inserta en `usuarios_organizacion`; rechaza un correo que ya sea de un usuario del panel (D5); reutiliza el usuario de Auth del cliente (D1); idempotente.
- `recuperar-clave-cliente`: envía el correo de Auth (plantilla de recuperación) solo si hay cuenta activa en esa tienda; redirección al dominio de la tienda.

## Funciones públicas (`publico`, solo funciones, sin tablas)

| Historia | Función |
|---|---|
| F-CLI-05 | `publico.acceso_cliente_por_dominio(host text) returns jsonb` (`authenticated`) |
| F-CLI-07 | `publico.precios_cliente_por_dominio(host text, productos uuid[]) returns jsonb` (`authenticated`) |

```ts
publico.acceso_cliente_por_dominio(host: string): {
  estado: 'activa' | 'suspendida' | 'sin_cuenta' | 'no_habilitado'
  tipo: 'minorista' | 'mayorista' | null   // solo si estado = 'activa'
} | null

publico.precios_cliente_por_dominio(host: string, productos: string[]): {
  tipo: 'minorista' | 'mayorista'
  precios: Array<{
    producto_id: string
    escalas: Array<{ escala: 'x1' | 'x5' | 'x10' | 'x50'; desde: number; hasta: number | null; final: number | null }>
  }>
} | null   // null si no hay cuenta activa habilitada en esa tienda
```

- `precios_…`: máximo de productos por llamada acotado (constante única); un minorista recibe solo `x1`; un mayorista las cuatro escalas (escala sin precio ⇒ valor de x1). `final` es el precio con/sin IVA según el interruptor de la empresa y coincide con `private.precio_para(...).final`.

## Funciones internas (`private`, sin `grant` a `anon`/`authenticated`)

| Historia | Función |
|---|---|
| F-CLI-07 | `private.precio_final_publico_escala(p_producto uuid, p_empresa uuid, p_escala text) returns numeric` |

## Configuración de Auth

- `supabase/config.toml` → `additional_redirect_urls`: se agregan los dominios de tienda (F-CLI-06, FR-024). `enable_signup = false` se conserva (FR-007).
