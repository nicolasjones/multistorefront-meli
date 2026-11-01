# Contratos · Tienda dominio y publicación (MSF-133)

Todo es **nuevo y aditivo** salvo la línea `BREAKING` de abajo. Las RPC de `public` validan sesión,
pertenencia de la empresa a la organización activa y `private.nivel_seccion('empresas') = 'edicion'`;
`revoke execute … from public, anon` y `grant execute … to authenticated` (salvo la indicada).

BREAKING: `public.guardar_tienda_identidad`, `public.guardar_tienda_contenido` y `public.guardar_catalogo_tienda` dejan de ser ejecutables por `authenticated` (solo las ejecuta `public.publicar_tienda`); la firma no cambia. Motivo: que todo cambio visible pase por el borrador y quede en una versión. El front se migra a `guardar_borrador_tienda` (F-TDA-06).

## F-TDA-05 · Dominio

```ts
public.configurar_dominio_tienda(empresa: uuid, dominio: text, redireccion: text | null): { dominio_vigente: string | null; dominio_pendiente: string | null; redireccion: string | null }
public.obtener_dominio_tienda(empresa: uuid): {
  dominio_vigente: string | null; dominio_pendiente: string | null; redireccion: string | null;
  dominio_verificado: boolean; certificado: 'pendiente' | 'activo' | 'error'; ultima_verificacion: string | null;
  registros: Array<{ tipo: 'A' | 'CNAME' | 'TXT'; nombre: string; valor: string; estado: 'correcto' | 'incorrecto' | 'pendiente'; encontrado: string | null }>
}
public.preparar_verificacion_tienda(empresa: uuid): { dominio: string; redireccion: string | null; token: string; ip_publica: string; cname_destino: string; prefijo_txt: string }
public.registrar_verificacion_dns(empresa: uuid, resultados: jsonb, certificado: text): void   // solo service_role
publico.redireccion_por_dominio(host: text): { dominio_principal: string } | null              // anon, authenticated
```

Errores de `configurar_dominio_tienda`: `dominio_invalido`, `dominio_en_uso`, `redireccion_invalida` (por campo). `preparar_verificacion_tienda`: `sin_permiso`, `sin_dominio`, `demasiado_pronto` (10 s). `publico.redireccion_por_dominio`: lista blanca (solo el dominio principal); desconocido y empresa desactivada devuelven `null`.

### Edge Function `verificar-dominio-tienda` (ver `openapi/verificar-dominio-tienda.json`)

```ts
POST /verificar-dominio-tienda  { empresa_id: string }  // Authorization: JWT del usuario
200 { dominio_verificado: boolean; certificado: 'pendiente' | 'activo' | 'error'; registros: Array<{ tipo; nombre; estado }> }
400 { error: 'solicitud_invalida' } · 401 · 403 { error: 'sin_permiso' } · 429 { error: 'demasiado_pronto' } · 502 { error: 'dns_no_disponible' }
```

## F-TDA-06 · Borrador y publicación

```ts
public.guardar_borrador_tienda(empresa: uuid, area: 'identidad' | 'contenido' | 'catalogo', datos: jsonb): void
public.obtener_borrador_tienda(empresa: uuid): {
  hay_borrador: boolean; identidad: jsonb | null; contenido: jsonb | null; catalogo: jsonb | null;
  cambios: { total: number; resumen: string; detalle: Array<{ area: string; campos: string[] }> };
  version_vigente: { numero: number; publicada_at: string; publicada_por: string | null } | null; en_linea: boolean
}
public.descartar_borrador_tienda(empresa: uuid): void
public.publicar_tienda(empresa: uuid): { version: number | null }   // null = no había borrador (idempotente)
public.vista_previa_tienda(empresa: uuid): jsonb                     // borrador sobre lo vivo; lista blanca sin costos, stock exacto ni proveedor
```

Errores de `guardar_borrador_tienda`: los mismos por campo que las RPC vivas (color, tipografía, longitud, destino).

## F-TDA-07 · Versiones

```ts
public.listar_versiones_tienda(empresa: uuid): Array<{ numero: number; publicada_at: string; publicada_por: string | null; cambios: string; vigente: boolean }>  // últimas 100
public.restaurar_version_tienda(empresa: uuid, numero: number): { omitidos: number }   // reemplaza el borrador; no publica
```

## Eventos de actividad (contrato F-AUD-01)

`tienda.dominio_configurado` (ya existe), `tienda.dominio_verificado`, `tienda.publicada`, `tienda.borrador_descartado`, `tienda.version_restaurada` — payload mínimo: empresa, actor, nombres de campos/áreas (no valores).
