# Contratos · Tienda WhatsApp y contacto (MSF-212)

Todo es **nuevo y aditivo**: no cambia la firma ni el resultado de nada existente. No hay `BREAKING`.

Reglas comunes de las funciones de `publico`: `SECURITY DEFINER`, `set search_path = ''`, normalizan `host` con `private.normalizar_host`, filtran por `dominio.empresas.activa`, devuelven una **lista blanca** de campos, `revoke execute … from public, anon` seguido de `grant execute … to anon, authenticated` explícito. Host desconocido y empresa desactivada devuelven **lo mismo**. Nunca devuelven `organizacion_id`, IP, hash del visitante ni columnas internas.

## Funciones públicas (`publico`, solo funciones, sin tablas)

| Historia | Función |
|---|---|
| F-TDA-16 | `publico.contacto_por_dominio(host text) returns jsonb` |
| F-TDA-16 | `publico.enviar_consulta_contacto(host text, nombre text, contacto text, mensaje text, clave_envio uuid) returns jsonb` |
| F-TDA-14 | `publico.registrar_consulta_whatsapp(host text, producto uuid, clave_envio uuid) returns jsonb` |

### `publico.contacto_por_dominio(host)`

```ts
publico.contacto_por_dominio(host: string): {
  nombre: string; whatsapp: string | null; correo: string | null; horarios: string | null
} | null
```

`null` para host desconocido o empresa desactivada. Los campos vacíos salen como `null`.

### `publico.enviar_consulta_contacto(...)`

```ts
publico.enviar_consulta_contacto(
  host: string, nombre: string, contacto: string, mensaje: string, clave_envio: string
): {
  estado: 'ok' | 'invalido' | 'limite' | 'error';
  campos?: Array<'nombre' | 'contacto' | 'mensaje'>;
  espera_segundos?: number
}
```

Valida (D7: nombre ≤ 100, contacto ≤ 120 con formato de correo o teléfono, mensaje ≤ 2000, todos obligatorios y recortados), aplica idempotencia por `clave_envio` y el límite de 5 por hora por visitante y empresa, y entrega por `private.entregar_a_bandeja` con `origen = 'formulario'`. `invalido` lista los campos con error; `limite` trae `espera_segundos`; `error` es genérico (host inexistente, empresa desactivada o falla de entrega).

### `publico.registrar_consulta_whatsapp(...)`

```ts
publico.registrar_consulta_whatsapp(
  host: string, producto: string, clave_envio: string
): { estado: 'ok' | 'limite' | 'error' }
```

Exige que el producto sea efectivamente visible en la tienda del host (`private.catalogo_tienda_efectivo`). Comparte límite e idempotencia con el formulario. Entrega con `origen = 'whatsapp'` y el producto. Host inexistente, empresa desactivada y producto ajeno u oculto responden **lo mismo** (`error`) y no registran nada.

**Datos del visitante**: el que abre WhatsApp desde la ficha no deja sus datos en la plataforma (la conversación ocurre en WhatsApp) y F-CON-01 exige nombre y contacto no vacíos, así que la consulta se registra con las marcas explícitas `Visitante de WhatsApp` y `visitante@sin-datos.invalid` (TLD reservado por RFC 2606: nunca resuelve a una casilla real). No se inventa un nombre ni un teléfono. El mensaje va `null`: la bandeja muestra que no dejó mensaje.

## Funciones internas (`private`, sin `grant` a roles de API)

```ts
private.visitante_hash(empresa: string): string
private.registrar_envio_tienda(empresa: string, origen: 'formulario' | 'whatsapp', clave_envio: string): 'nuevo' | 'repetido' | { limite: number }
private.entregar_a_bandeja(empresa: string, origen: 'formulario' | 'whatsapp', nombre: string | null, contacto: string | null, mensaje: string | null, producto: string | null): void
```

- `registrar_envio_tienda`: toma `pg_advisory_xact_lock` por (empresa, visitante), poda filas de más de 24 h, devuelve `repetido` si la clave existe, `limite` con los segundos de espera si hay 5 en la última hora, o inserta y devuelve `nuevo`.
- `entregar_a_bandeja`: **único adaptador** hacia la interfaz de entrada F-CON-01 de MSF-122. **Firma real confirmada (T003, D4 resuelta)**: `publico.crear_consulta_publica(host text, origen text, nombre text, contacto text, mensaje text default null, producto_id uuid default null) returns uuid` (migración `20261205100100`; `origen` ∈ `formulario|whatsapp`, mensaje obligatorio solo en `formulario`, contacto correo o teléfono de 7 a 15 dígitos). El adaptador recibe la empresa y resuelve su dominio en `dominio.tiendas`; si la entrega falla, la excepción revierte el registro del envío (`enviar_consulta_contacto` la atrapa en una subtransacción y responde `error`). El teléfono admite 8 a 15 dígitos para no superar el tope de la bandeja.

## Datos

```ts
dominio.tienda_envios: {
  id: string; organizacion_id: string; empresa_id: string; visitante: string  // hash, nunca la IP
  clave_envio: string; origen: 'formulario' | 'whatsapp'; creado_en: string
}  // unique (empresa_id, clave_envio); RLS por organización; sin privilegios para anon
dominio.empresas.horarios: string | null  // nueva columna, ≤ 200
```

## Rutas del front público

| Ruta | Historia |
|---|---|
| `/contacto` (`/contacto/<algo>` → 404 amable) | F-TDA-16 |
| `/producto/:productoId` (existente, suma botón y diálogo) | F-TDA-14 |
