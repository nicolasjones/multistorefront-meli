# Contratos: Service técnico · Service ideas futuras (MSF-118)

Funciones nuevas o alteradas del esquema `public` (superficie RPC del panel) y funciones `private` de apoyo. Todas: `security definer`, `set search_path = ''`, nombres calificados, **sin SQL dinámico**, `revoke execute … from public, anon` y `grant execute … to authenticated` explícitos (las `private.*` no son ejecutables por la API). Los nombres y las firmas exactos de lo existente (`obtener_reparacion`, `avisos_de_reparacion`, `private.registrar_actividad`, `private.empresas_accesibles`, `private.puede_accion`, `private.nivel_seccion`, `private.codigo_reparacion`, `private.hoy_argentina`) se **verifican contra `dokploy` al implementar**; lo que no exista se declara acá.

## Convenciones comunes

- **Organización y actor** salen de la sesión (`private.organizacion_id()`, `auth.uid()`); ninguna función recibe `organizacion_id`.
- **Tienda**: toda reparación o empresa pedida debe estar en `private.empresas_accesibles()`; una reparación inexistente, ajena o de una tienda no accesible responde **lo mismo** (`P0002`, «La reparación no existe»), sin distinguir.
- **Errores** (`errcode`): `42501` sin permiso (mensaje en castellano sin detalle técnico), `P0002` no existe o no accesible, `22023` dato inválido (con `hint` = nombre del campo), `55000` reparación anulada, `23505` duplicado. Nunca se devuelve el texto de Postgres en una respuesta de negocio.
- **Fechas**: `date` sin zona horaria; «hoy» = `private.hoy_argentina()` (día de Buenos Aires).
- **Importes**: ARS, `numeric`, redondeo a 2 decimales **por reparación**; las sumas son de esos redondeos.
- **Actividad**: `private.registrar_actividad(tipo, descripcion, empresa)` en la misma transacción; las descripciones **no llevan** teléfono, correo ni nombre de persona.

---

## F-SVC-30 · Aviso por WhatsApp

### `public.datos_aviso_whatsapp(p_reparacion uuid) → jsonb`

- **Quién**: `service_tecnico` en `edicion`. `stable`. Sin escritura.
- **Errores**: `42501` (sin permiso), `P0002` (no existe o tienda no accesible), `55000` («La reparación está anulada: no se puede avisar al cliente»).
- **Salida** (claves **exactas**; nada más):

```json
{
  "reparacion_id": "uuid",
  "codigo": "R-0238",
  "tienda": "San Javucho",
  "equipo": "PlayStation 5",
  "estado_id": "uuid",
  "estado": "Listo para entregar",
  "estado_descripcion": "Se avisa al cliente para que retire.",
  "cliente_nombre": "Ana Pérez",
  "telefonos": [
    { "origen": "celular",  "valor": "11 2345-6789" },
    { "origen": "telefono", "valor": "4444-5555" },
    { "origen": "contacto", "valor": "11 2345-6789" }
  ]
}
```

- `telefonos` lista solo los no vacíos, en el orden celular, teléfono, contacto de la reparación (D-3); el valor es el texto cargado (la normalización es del front con `normalizarNumero`). `equipo` es el nombre del modelo. **No devuelve**: correo, domicilio, documento, notas, costos ni importes.

### `public.registrar_aviso_whatsapp(p_reparacion uuid, p_estado_id uuid, p_destino text, p_clave uuid) → jsonb`

- **Quién**: `service_tecnico` en `edicion` y tienda accesible.
- **Entrada**: `p_estado_id` nulo = estado actual; `p_destino` = dígitos internacionales **ya normalizados** (`^[0-9]{8,15}$`, sin `+`); `p_clave` = uuid generado por el front al abrir el diálogo (obligatorio).
- **Errores**: `42501`, `P0002`, `55000`, `22023` (`hint = 'destino'` si no cumple el formato; `hint = 'estado_id'` si el estado no es de la organización; `hint = 'clave'` si falta).
- **Efecto** (una transacción): inserta en `dominio.reparacion_avisos` `{ organizacion_id, empresa_id (de la reparación), reparacion_id, estado_id, estado_nombre (copia), destinatario = p_destino, canal = 'whatsapp', estado_envio = 'abierto', clave_envio = p_clave, solicitado_por = auth.uid() }`; registra `reparacion.aviso_whatsapp_abierto` con la descripción «Abrió WhatsApp para avisar de la reparación R-0238 (estado «Listo para entregar»)».
- **Idempotencia**: la segunda llamada con la misma `(p_reparacion, p_clave)` no inserta y devuelve la fila existente con `repetido = true`.
- **Salida**: `{ "aviso_id": "uuid", "repetido": false }`.

### `dominio.reparacion_avisos` (alterada)

| Columna | Cambio |
|---|---|
| `canal text not null default 'correo'` | `check (canal in ('correo','whatsapp'))` |
| `clave_envio uuid` | nula para correo; obligatoria para WhatsApp; índice único `(reparacion_id, clave_envio) where canal = 'whatsapp'` |
| `estado_envio` | el `check` suma `'abierto'` |
| `reparacion_avisos_canal_estado_ck` | `canal = 'whatsapp'` ⇒ `estado_envio = 'abierto'` **y** `enviado_en is null` **y** `clave_envio is not null`; `canal = 'correo'` ⇒ `estado_envio in ('pendiente','enviado','fallido')` |
| grants | `canal` se suma a la lista de columnas con `select` para `authenticated` (`destinatario` y `ejecucion_id` siguen sin `select` directo) |

### `public.avisos_de_reparacion(p_reparacion uuid) → …` (alterada, aditiva)

Devuelve, además de lo que ya devuelve, `canal` (`correo` | `whatsapp`) por fila. Orden y demás claves **sin cambios**. `estado_envio` puede ser ahora `abierto`; `destinatario` de una fila de WhatsApp es el número en dígitos.

---

## F-SVC-31 · Comisiones

### `dominio.comision_reglas` (nueva, esquema `dominio`)

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organizacion_id` | uuid not null | por defecto `private.organizacion_id()`; FK a `public.organizaciones` `on delete cascade` |
| `empresa_id` | uuid null | nulo = todas las tiendas; FK compuesta `(empresa_id, organizacion_id)` a `dominio.empresas` |
| `tecnico_id` | uuid null | nulo = todos; referencia a `auth.users`; un disparador exige membresía en la organización |
| `porcentaje` | numeric(5,2) not null default 0 | `check (porcentaje between 0 and 100)` |
| `monto_fijo` | numeric(12,2) not null default 0 | `check (monto_fijo between 0 and 99999999.99)` |
| `vigente_desde` | date not null | |
| `creado_por` | uuid | `auth.users`, `on delete set null` |
| `creado_en` | timestamptz not null default now() | |

- Único: `(organizacion_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'), coalesce(tecnico_id, '00000000-0000-0000-0000-000000000000'), vigente_desde)`.
- RLS: `select` a `authenticated` con `organizacion_id = private.organizacion_id()` y `private.nivel_seccion('service_tecnico') in ('lectura','edicion')` y `private.puede_accion('service_tecnico','ver_costos')`. **Sin** políticas ni grants de `insert/update/delete`; sin `delete` nunca; `anon` nada.

### `public.guardar_regla_comision(p_empresa uuid, p_tecnico uuid, p_porcentaje numeric, p_monto_fijo numeric, p_vigente_desde date) → jsonb`

- **Quién**: `service_tecnico` en `edicion` **y** acción `ver_costos`.
- **Validaciones** (`22023` con `hint`): `p_porcentaje` en 0–100 (`porcentaje`); `p_monto_fijo` en 0–99.999.999,99 (`monto_fijo`); `p_vigente_desde` entre `hoy − 31 días` y `hoy + 90 días` (`vigente_desde`); `p_empresa` accesible y de la organización (`empresa`); `p_tecnico` miembro de la organización (`tecnico`). Duplicado de alcance y fecha: `23505`, «Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.».
- **Efecto**: inserta la regla; registra `comision.regla_guardada` («Cargó una regla de comisión: técnico {nombre o “todos”}, tienda {nombre o “todas”}, {porcentaje} % + $ {monto}, desde {fecha}» — **sin** importes de comisión calculados).
- **Salida**: `{ "regla_id": "uuid" }`.

### `public.listar_reglas_comision() → jsonb`

- **Quién**: `service_tecnico` ≥ lectura **y** `ver_costos`.
- **Salida**: arreglo ordenado por alcance y `vigente_desde desc`:

```json
[{ "id": "uuid", "empresa_id": null, "empresa": null, "tecnico_id": "uuid", "tecnico": "Ana Pérez",
   "porcentaje": 15.00, "monto_fijo": 500.00, "vigente_desde": "2026-11-01",
   "estado": "vigente" }]
```

- `estado`: `vigente` (la de mayor `vigente_desde ≤ hoy` de su alcance), `futura` (`vigente_desde > hoy`), `reemplazada` (existe otra del mismo alcance con `vigente_desde` mayor y `≤ hoy`).

### `private.regla_comision(p_org uuid, p_empresa uuid, p_tecnico uuid, p_fecha date)`

Devuelve la regla (`id`, `porcentaje`, `monto_fijo`, `alcance`) o nada. **Precedencia determinista**: 1) `tecnico_id = p_tecnico` y `empresa_id = p_empresa`; 2) `tecnico_id = p_tecnico` y `empresa_id` nulo; 3) `tecnico_id` nulo y `empresa_id = p_empresa`; 4) ambos nulos. Dentro del alcance elegido, la de mayor `vigente_desde ≤ p_fecha`; si un alcance más específico no tiene ninguna vigente a esa fecha, se pasa al siguiente. `alcance` ∈ `tecnico_tienda | tecnico | tienda | general`.

### `private.comisiones_calculadas(p_org uuid, p_desde date, p_hasta date, p_empresa uuid, p_tecnico uuid)`

Una fila por reparación con: `reparacion_id`, `numero`, `empresa_id`, `tecnico_id`, `entrega_real`, `base`, `regla_id`, `porcentaje`, `monto_fijo`, `alcance`, `comision`, `cobrada`, `tiene_comprobante`.

- **Universo**: `reparaciones` de la organización con `entrega_real between p_desde and p_hasta`, `anulada_en is null`, `tecnico_id is not null`, `empresa_id` en `private.empresas_accesibles()` (y igual a `p_empresa` / `p_tecnico` si vienen).
- **`base`** = `coalesce(sum(i.subtotal) filter (where i.tipo = 'mano_obra'), 0)` agregada por reparación **antes** de cualquier otro join. **Nunca** lee `costo_mano_obra` ni `costo_repuestos`.
- **`comision`** = `round(base * porcentaje / 100, 2) + case when base > 0 then monto_fijo else 0 end`; sin regla, `0`.
- **`cobrada`** = existe comprobante con `origen_tipo = 'reparacion'`, `origen_id = reparacion`, `estado <> 'anulada'` y `estado = 'cobrado'`; `tiene_comprobante` = existe uno no anulado. (Se resuelve con `exists`/subconsulta: una reparación nunca aparece dos veces.)

### `public.comisiones_resumen(p_desde date, p_hasta date, p_empresa uuid default null, p_tecnico uuid default null) → jsonb`

- **Quién**: `service_tecnico` ≥ lectura **y** `ver_costos`.
- **Errores**: `42501`; `22023` (`hint = 'periodo'`) si `p_desde > p_hasta` o el rango supera 366 días; `p_empresa` no accesible o ajena: respuesta vacía idéntica a «sin datos» (no distingue).
- **Salida**:

```json
{
  "tecnicos": [
    { "tecnico_id": "uuid", "nombre": "Ana Pérez", "reparaciones": 12,
      "base": 180000.00, "comision": 27500.00, "cobrada": 20000.00, "pendiente": 7500.00 }
  ],
  "totales": { "reparaciones": 20, "base": 276000.00, "comision": 37100.00, "cobrada": 29600.00, "pendiente": 7500.00 },
  "sin_tecnico": { "reparaciones": 3 },
  "sin_regla": { "reparaciones": 2 },
  "hay_reglas": true
}
```

- `cobrada` = Σ `comision` de las filas con `cobrada`; `pendiente` = `comision − cobrada`. `sin_tecnico` cuenta las reparaciones entregadas, no anuladas, del rango y de las tiendas accesibles **sin** técnico (no entran en `tecnicos` ni en `totales`). `sin_regla` cuenta las que tienen técnico pero ninguna regla aplicable (entran con comisión 0). `hay_reglas` = existe al menos una regla en la organización. `nombre` = nombre y apellido del perfil o, a falta, el correo del miembro (igual que `tecnicos_de_service`). Orden: `comision desc, nombre`.

### `public.comisiones_detalle(p_tecnico uuid, p_desde date, p_hasta date, p_empresa uuid default null, p_despues_fecha date default null, p_despues_id uuid default null, p_limite integer default 25) → jsonb`

- **Quién y errores**: como el resumen. `p_limite` se acota a 1–100.
- **Orden y cursor**: `entrega_real desc, id desc`; el cursor `(p_despues_fecha, p_despues_id)` solo ordena, no autoriza (la consulta siempre filtra por organización, técnico y tiendas accesibles).
- **Salida** (claves **exactas**; sin datos del cliente):

```json
{
  "total_filas": 12,
  "filas": [
    { "reparacion_id": "uuid", "codigo": "R-0238", "empresa": "San Javucho", "equipo": "PlayStation 5",
      "entrega_real": "2026-11-12", "base": 15000.00,
      "regla": { "porcentaje": 15.00, "monto_fijo": 500.00, "alcance": "tecnico" },
      "comision": 2750.00, "cobro": "cobrada" }
  ]
}
```

- `regla` nulo si no hay regla aplicable; `cobro` ∈ `cobrada | pendiente | sin_comprobante`. **Invariante**: Σ `comision` de todas las filas (recorriendo el cursor) = `comision` del técnico en el resumen del mismo rango y filtros.

### Disparador de técnico en reparación entregada

En `private.validar_reparacion()` (o un disparador nuevo antes de `update` en `dominio.reparaciones`): si `old.entrega_real is not null` y `new.tecnico_id is distinct from old.tecnico_id` y `auth.uid()` no nulo y **no** `private.puede_accion('service_tecnico','ver_costos')`, `raise exception 'La reparación ya fue entregada: solo quien ve costos puede cambiar el técnico' using errcode = '22023', hint = 'tecnico_id'`. Sin sesión (migraciones, sembrados) no se aplica. Se registra la actividad `reparacion.tecnico_cambiado_entregada` cuando lo permite `ver_costos`.

---

## F-SVC-32 · Etiqueta con QR (sin base de datos)

Sin RPC ni tablas. Contratos del front:

### `urlEtiquetaReparacion(origen: string, id: string): string` (`lib/etiquetaReparacion.ts`)

- Devuelve exactamente `` `${origen sin barras finales}/service-tecnico/reparaciones/${id}` ``.
- `id`: solo `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (sin distinguir mayúsculas; se devuelve tal cual); `origen`: `http:` o `https:` con host ASCII (nombre, incluido `*.localhost`, o IPv6 entre corchetes como `[::1]`) y puerto opcional, sin credenciales (`user:pass@`), sin ruta (salvo una barra final), sin query ni fragmento. Cualquier otra entrada lanza `Error` (nunca se imprime una etiqueta con una URL distinta de la prevista).
- Es lo **único** que se codifica en el QR.

### `generarQr(texto: string): { version: number, tamano: number, modulos: boolean[][] }` (`lib/qr/`)

- UTF-8, modo byte, corrección **M**, versiones 1–10 (capacidad en bytes: 14, 26, 42, 62, 84, 106, 122, 152, 180, 213), versión mínima que entra, máscara de menor penalización (reglas 1–4 de la norma), información de formato (BCH 15,5) y de versión (BCH 18,6 desde la versión 7), módulo oscuro fijo.
- `tamano = 17 + 4 × version`. `modulos[fila][columna]` verdadero = oscuro. Lanza `QrDemasiadoLargo` si el texto pasa de 213 bytes.
- `qrASvgPath(modulos, { zonaQuieta = 4 }): string` (el `d` de un único `<path>`) y `qrASvg(...)`: `{ path, lado, viewBox }`; corridas horizontales fusionadas `M x y h<largo> v1 h-<largo> z`, coordenadas enteras.

### Medidas de la etiqueta (`lib/etiquetaReparacion.ts`)

- `TAMANOS_ETIQUETA`: `chica 40×25`, `mediana 50×30` (por defecto), `grande 70×40` (mm); `personalizada` con `ancho ∈ [25,100]`, `alto ∈ [15,100]` enteros; `copias ∈ [1,10]`.
- `moduloMinimoMm = 0.4`. Lado del QR = `min(alto − 3 mm, (ancho − 3 mm) × 0.6)` en horizontal (ancho ≥ 1,25 × alto) y `min(ancho − 3 mm, (alto − 3 mm) × 0.6)` en vertical (nunca más del 60 % de la dimensión que comparte con el texto); `mmPorModulo = ladoQr / (tamano + 2 × zonaQuieta)`; si `mmPorModulo < 0.4`, la etiqueta está «demasiado chica».
- Preferencia en `localStorage['msf.service.etiqueta']` = `{ "tamano": "mediana", "ancho": 50, "alto": 30 }` (sin copias; `ancho` y `alto` son las medidas de «Personalizada» y se conservan aunque se elija otro tamaño); lectura validada y recortada; acceso en `try/catch`.
