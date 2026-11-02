# Contrato: contactos y respuestas rápidas

Épica MSF-144 · spec `contactos-y-respuestas-rapidas`. Todo es **nuevo y aditivo**. Ninguna RPC es para `anon`. Todas `security definer` (salvo `buscar_contactos`, `security invoker`: la RLS de `dominio.contactos` decide las filas), `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`. Errores comunes: `42501` sin permiso, `40001` conflicto de `updated_at`, `22023` datos inválidos, `23505` duplicado (con el id del contacto existente en `DETAIL`).

## Contactos (F-CON-05)

```ts
public.crear_contacto(p_empresa_id: uuid, p_nombre: text, p_correo: text | null, p_telefono: text | null, p_consentimiento: boolean, p_consentimiento_texto: text, p_consulta_id: uuid | null): uuid
public.actualizar_contacto(p_id: uuid, p_nombre: text, p_correo: text | null, p_telefono: text | null, p_updated_at: timestamptz): timestamptz
public.buscar_contactos(p_empresa_id: uuid | null, p_busqueda: text | null, p_limite: int, p_desde: int): table(...)
public.historial_contacto(p_contacto_id: uuid): table(tipo: text, referencia_id: uuid, fecha: timestamptz, empresa_id: uuid, empresa_nombre: text, resumen: text, estado: text, total: numeric | null)
public.vincular_consulta_contacto(p_consulta_id: uuid, p_contacto_id: uuid): void
public.vincular_comprobante_contacto(p_comprobante_id: uuid, p_contacto_id: uuid | null): void
public.anonimizar_contacto(p_id: uuid, p_updated_at: timestamptz): void
```

- `crear_contacto` exige `p_consentimiento = true` y al menos correo o teléfono; calcula las claves normalizadas; si p_consulta_id viene, vincula la consulta (misma empresa). `23505` si ya existe un contacto activo con ese correo o teléfono en la empresa.
- `historial_contacto`: `tipo` ∈ `consulta` | `compra`; solo empresas de `private.empresas_accesibles()`.
- `anonimizar_contacto`: irreversible; reemplaza datos personales del contacto y de `dominio.consultas` vinculadas; no toca `comprobantes_venta`.
- `buscar_contactos` con `p_empresa_id = null` devuelve las empresas accesibles (modo «Todas mis empresas»).

## Vista alterada (aditiva, no BREAKING)

```ts
public.consultas_bandeja  // + contacto_id uuid (al final)
```

## Respuestas rápidas (F-CON-06)

```ts
public.respuestas_rapidas_lista  // vista security_invoker: id, organizacion_id, empresa_id, empresa_nombre, titulo, texto, updated_at
public.guardar_respuesta_rapida(p_id: uuid | null, p_empresa_id: uuid, p_titulo: text, p_texto: text): uuid
public.eliminar_respuesta_rapida(p_id: uuid): void
```

Límites: `titulo` ≤ 80, `texto` ≤ 1000. Las variables se resuelven en el navegador (`{nombre}`, `{tienda}`, `{producto}`), no en la base.

## Columnas nuevas (tablas existentes)

`dominio.consultas.contacto_id uuid null` y `dominio.comprobantes_venta.contacto_id uuid null`, FK compuesta `(contacto_id, organizacion_id) → dominio.contactos (id, organizacion_id)`.
