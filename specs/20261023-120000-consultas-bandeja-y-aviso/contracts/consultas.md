# Contratos: Consultas bandeja y aviso (MSF-122)

Todo es nuevo (no se cambia la firma de nada existente). Cada RPC: `security definer` solo donde se indica, `set search_path = ''`, `revoke … from public, anon` salvo la pública.

## Pública (la llama la tienda, MSF-212)

```ts
publico.crear_consulta_publica(host: text, origen: text, nombre: text, contacto: text, mensaje: text default null, producto_id: uuid default null): uuid
```

- Ejecutable por `anon` y `authenticated`. La empresa se resuelve **solo** por `host` (`dominio.tiendas`, MSF-147); no recibe `empresa_id`.
- `origen` ∈ `formulario` | `whatsapp`. `mensaje` obligatorio salvo `whatsapp`. `contacto` = correo o teléfono.
- Errores: `22023` datos inválidos (con detalle por campo), `P0002` dominio desconocido o empresa desactivada (mensaje genérico, idéntico en ambos casos).
- Devuelve el id de la consulta. Efecto lateral: encola un aviso (`dominio.consultas_avisos`).

## Internas (panel, `authenticated`)

```ts
public.actualizar_consulta(p_id: uuid, p_estado: text, p_responsable_id: uuid | null, p_nota_interna: text | null, p_updated_at: timestamptz): timestamptz
public.contar_consultas_nuevas(p_empresa_id: uuid default null): integer
public.responsables_consultas(p_empresa_id: uuid): setof (user_id uuid, nombre text)
public.guardar_correo_avisos_consultas(p_empresa_id: uuid, p_correo: text | null, p_updated_at: timestamptz default null): timestamptz
```

- `actualizar_consulta`: `consultas`=`edicion`; `p_estado` ∈ `nueva` | `en_curso` | `resuelta`; devuelve el nuevo `updated_at`; `40001` si `p_updated_at` no coincide (conflicto); `42501` sin permiso; `22023` responsable inválido.
- `guardar_correo_avisos_consultas`: `empresas`=`edicion`; `p_correo` null = volver al correo de contacto; `22023` formato inválido; `40001` conflicto.

## Vistas

```ts
public.consultas_bandeja  // security_invoker; columnas: id, empresa_id, empresa_nombre, origen, nombre, contacto, mensaje, producto_id, producto_nombre, estado, responsable_id, responsable_nombre, nota_interna, created_at, updated_at
```

## Edge Function

```ts
POST /functions/v1/enviar-aviso-consulta  { consulta_id: uuid }  →  { estado: 'enviado' | 'fallido' | 'sin_destinatario' | 'ya_enviado' }
```

Invocada por la base al encolar y por el barrido de pendientes; idempotente por `consulta_id`. Usa `SMTP_*` y `PANEL_URL`.
