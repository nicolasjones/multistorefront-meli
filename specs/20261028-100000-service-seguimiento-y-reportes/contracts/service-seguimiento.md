# Contratos · Service seguimiento y reportes (MSF-124)

Todas las RPC viven en `public`, llevan `revoke execute … from public, anon` y `grant execute … to authenticated` (salvo las marcadas «solo service_role»). Errores: validación `22023` con el campo en `hint`; sin permiso `42501`; situación no permitida `55000`; inexistente o tienda inaccesible `P0002`. **BREAKING: ninguno** — no se cambia la firma de ninguna función existente (`crear_reparacion`, `obtener_reparacion`, `listar_reparaciones` y `resolver_organizacion_reporte` quedan como están).

## F-SVC-20 · Adjuntos

```ts
registrar_adjunto_reparacion(p_reparacion uuid, p_ruta text, p_nombre text, p_mime text, p_bytes integer) -> jsonb  // security definer; edicion
quitar_adjunto_reparacion(p_adjunto uuid) -> jsonb                                                           // security definer; edicion; devuelve { ruta }
listar_adjuntos_reparacion(p_reparacion uuid) -> jsonb                                                       // lectura; [{ id, ruta, nombre_original, mime, bytes, creado_en, subido_por }]
```

Bucket `reparacion-adjuntos` (privado): ruta `<organizacion_id>/<reparacion_id>/<uuid>.<ext>`; 5 MB; `image/jpeg`, `image/png`, `image/webp`.

## F-SVC-21 · Garantía

```ts
reingresar_por_garantia(p_reparacion_origen uuid, p_falla text, p_tecnico uuid, p_entrega_prevista date) -> jsonb  // security definer; edicion; devuelve la reparación nueva con `codigo`
obtener_vinculos_garantia(p_reparacion uuid) -> jsonb                                                              // lectura; { origen: {id, codigo} | null, reingresos: [{id, codigo, estado, ingreso}] }
```

## F-SVC-22 · Enlace de consulta

```ts
obtener_enlace_consulta(p_reparacion uuid) -> jsonb                  // security definer; edicion; { token }; idempotente
registrar_consulta_publica(p_ip_hash text, p_ventana_seg integer, p_limite integer) -> jsonb  // SOLO service_role; { permitido, restantes, reintentar_en }
```

`private.estado_publico_reparacion(p_token text) -> jsonb` — interna, solo `service_role` mediante envoltorio; devuelve **únicamente**: `codigo`, `tienda`, `equipo`, `modelo`, `estado { nombre, descripcion }`, `entrega_prevista`, `linea_de_tiempo [{ estado, fecha }]`.

Edge Function `consultar-estado-reparacion` (sin sesión):

```ts
POST consultar-estado-reparacion { token: string } -> 200 { ...estado_publico } | 404 { error: 'no_encontrada' } | 429 { error: 'demasiadas_consultas' } + Retry-After
```

Cabeceras de toda respuesta: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. Variable nueva (solo en `supabase/functions/.env.example`): `SEGUIMIENTO_IP_SALT`.

## F-SVC-23 · Reportes

Sin RPC nueva. Vistas de lectura para Superset (`select` solo `superset_analitica`, columna aislante `organizacion_id`, sin costos internos):

```ts
analitica.service_reparaciones         // una fila por reparación
analitica.service_reparacion_items     // una fila por ítem
```

Reporte `public.reportes` con `seccion = 'service_tecnico'`; token por `emitir-acceso-reporte` (contrato vigente de spec 007, sin cambios).
