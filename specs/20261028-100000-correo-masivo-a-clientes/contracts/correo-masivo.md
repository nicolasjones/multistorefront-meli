# Contratos · Correo masivo a clientes (MSF-155)

Todo es **nuevo y aditivo**; no cambia la firma de nada existente. No hay `BREAKING`.
Toda función de `public` que llama la app lleva `revoke execute … from public, anon` y `grant execute … to authenticated` explícitos (pgTAP de superficie de `anon`). Las `private.*` las ejecuta solo `kestra_orquestacion` o `service_role`. Todas son `security invoker` salvo las marcadas `definer`.

## RPC del panel (`public`)

| Historia | Función |
|---|---|
| F-CLI-11 | `public.listar_destinatarios_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes, p_pagina, p_tamano)` |
| F-CLI-11 | `public.resumen_destinatarios_correo_masivo(p_texto, p_tipo, p_empresa, p_con_cuenta_web, p_clientes)` |
| F-CLI-12 | `public.crear_campana_correo(p_clave, p_asunto, p_mensaje, p_empresa, p_texto, p_tipo, p_con_cuenta_web, p_clientes)` (`definer`) |
| F-CLI-12 | `public.solicitar_prueba_correo_masivo(p_asunto, p_mensaje)` (`definer`) |
| F-CLI-13 | `public.listar_campanas_correo(p_empresa, p_pagina, p_tamano)` |
| F-CLI-13 | `public.detalle_campana_correo(p_campana, p_pagina, p_tamano)` |

```ts
public.listar_destinatarios_correo_masivo(p_texto: string | null, p_tipo: 'minorista' | 'mayorista' | null, p_empresa: string | null, p_con_cuenta_web: boolean, p_clientes: string[] | null, p_pagina: number, p_tamano: number): { total: number; filas: Array<{ id: string; numero: number; nombre: string; correo: string }> }
public.resumen_destinatarios_correo_masivo(p_texto: string | null, p_tipo: string | null, p_empresa: string | null, p_con_cuenta_web: boolean, p_clientes: string[] | null): { elegibles: number; sin_correo: number; no_aceptan: number }
public.crear_campana_correo(p_clave: string, p_asunto: string, p_mensaje: string, p_empresa: string | null, p_texto: string | null, p_tipo: string | null, p_con_cuenta_web: boolean, p_clientes: string[] | null): string
public.solicitar_prueba_correo_masivo(p_asunto: string, p_mensaje: string): void
public.listar_campanas_correo(p_empresa: string | null, p_pagina: number, p_tamano: number): { total: number; filas: Array<{ id: string; creada_en: string; asunto: string; autor: string; estado: 'en_curso' | 'completada'; destinatarios: number; enviados: number; fallidos: number; omitidos: number; bajas: number }> }
public.detalle_campana_correo(p_campana: string, p_pagina: number, p_tamano: number): { campana: { id: string; asunto: string; mensaje: string; estado: string; creada_en: string; autor: string }; total: number; destinatarios: Array<{ cliente_id: string; nombre: string; correo: string; estado: 'pendiente' | 'enviado' | 'fallido' | 'omitido'; error: string | null }> }
```

`p_clave` (uuid generado por el navegador al abrir el diálogo) hace idempotente el doble clic. `p_clientes` restringe a los marcados en el listado; con `null` manda el filtro.

## Funciones del flow (`private`, rol `kestra_orquestacion`)

```ts
private.reclamar_lote_correo_masivo(p_lote: number, p_limite_diario: number, p_vence_seg: number): Array<{ destinatario_id: string; campana_id: string; correo: string; asunto: string; mensaje: string; token: string }>
private.cerrar_envio_correo_masivo(p_destinatario: string, p_resultado: 'enviado' | 'fallido', p_error: string | null): void
public.dar_de_baja_correo_masivo(p_token_hash: string): boolean   // (ver nota: vive en `public`, solo service_role)
```

`reclamar_lote_correo_masivo` re-verifica activo, aceptación y correo (FR-020), marca `omitido` a quien ya no corresponde y no supera el cupo del día. `dar_de_baja_correo_masivo` solo la ejecuta `service_role` (Edge Function); es idempotente. Vive en `public` (no en `private`) porque supabase-js solo llama RPC de esquemas expuestos; `anon` y `authenticated` no la ejecutan. Recibe el SHA-256 en hex del token (64 caracteres). `reclamar_lote_correo_masivo` entrega primero las pruebas del autor (`campana_id` y `token` en null; tabla `dominio.correo_masivo_pruebas`, FR-014) y `cerrar_envio_correo_masivo` cierra tanto destinatarios como pruebas.

## Edge Function pública

```ts
POST baja-correo-masivo { token: string } -> { ok: true }
```

Sin JWT; calcula el hash del token y llama a `private.dar_de_baja_correo_masivo`. Responde `{ ok: true }` también ante token desconocido (no enumera).

## Ajustes de implementación de F-CLI-13 (MSF-376)

- `listar_campanas_correo` y `detalle_campana_correo` son `security definer` (no invoker): leen el nombre del autor en
  `perfiles_usuario` (self-only) y validan dentro la organización y el acceso `lectura`/`edicion` a `clientes`.
- Las filas suman `pendientes` y el detalle trae `campana.empresa_id`, los totales y, por destinatario, `baja: boolean`.
- Columna nueva `dominio.campana_correo_destinatarios.baja_en` para atribuir la baja a la campaña del enlace (FR-033);
  `dar_de_baja_correo_masivo` la completa.
- El historial vive en `/clientes/correo-masivo/historial` y su detalle en `/clientes/correo-masivo/historial/:id`.
