# Implementation Plan: Retención y supresión de consultas, ítems y presupuestos de la tienda (MSF-944)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `supabase` (migración + pgTAP) y
`kestra` (flow programado). Sin `refine`: no hay pantallas (D-24).

## Enfoque técnico

Una sola migración aditiva (`20270507200101_retencion_y_supresion_consultas_tienda.sql`) con cuatro
piezas y un flow de Kestra que la dispara. Todo en el esquema `private` salvo la columna de la cola
de avisos (`public`, que es plataforma).

### 1. La cola de avisos ata su fila a la consulta (D-25)

- `public.avisos_pendientes` suma la columna `consulta_id uuid` (nullable) con FK a
  `dominio.consultas (id) on delete cascade`. Es el arreglo del punto más frágil del assessment:
  la cola guardaba el nombre, el contacto y el mensaje del visitante **sin relación con la
  consulta** y sin purga, así que borrar la consulta no borraba la copia.
- `private.emitir_aviso(text, uuid, jsonb, uuid)` (misma firma): lee la clave interna `ConsultaId`
  del payload, la valida con una regex (nunca hace un cast que pueda fallar), la guarda en la
  columna y **la saca del payload**: el correo que manda el flow `enviar-avisos` queda idéntico.
- `private.emitir_aviso_consulta(uuid)` suma `'ConsultaId', v_c.id` al payload. Es el único camino
  de los avisos de consulta (`consulta_nueva`), así que toda fila de la cola queda atada.

### 2. Marcas de supresión

- `dominio.consultas.suprimido_en timestamptz` (nullable) y
  `dominio.presupuestos_tienda.suprimido_en timestamptz` (nullable). Son marcas, no un estado nuevo:
  la fila sigue siendo la misma y el panel no cambia (Principio VI: no se inventa UI).
- Índices de apoyo: `consultas (updated_at) where estado <> 'en_curso'` (la purga), `consultas
  (organizacion_id, lower(btrim(contacto)))` (la supresión) y `presupuestos_tienda (creado_en)`.

### 3. `private.purgar_consultas_tienda(p_retencion_dias integer default 180) returns integer`

`security definer`, `search_path = ''`, `volatile`. Precedente: `private.purgar_api_llamadas` y
`private.depurar_registro_actividad`.

- Valida el plazo (1 a 3650 días; si no, `22023` con el texto `RETENCION_INVALIDA`).
- Exige el rol de orquestación (`kestra_orquestacion` / `workers_orquestacion`) **en tiempo de
  ejecución** (como `depurar_registro_actividad`): si no, `42501` y no borra nada.
- Borra las consultas con `estado <> 'en_curso'` y `updated_at` anterior al corte. Los ítems se van
  en cascada; los avisos de esa consulta, también (FK `on delete cascade`).
- Vacía la `nota` de los presupuestos de la tienda con `creado_en` anterior al corte. **No toca**
  `dominio.comprobantes_venta`.
- Deja un evento `sistema.depurada` por organización con las dos cantidades (sin datos personales) y
  devuelve la cantidad de consultas borradas.
- Idempotente: la segunda pasada no borra nada ni suma eventos.

### 4. `private.suprimir_titular_tienda(p_organizacion uuid, p_contacto text) returns integer`

`security definer`, `search_path = ''`, `volatile`. Procedimiento técnico (D-24), no RPC de API.

- Exige rol técnico (`kestra_orquestacion`, `workers_orquestacion` o `service_role`) en tiempo de
  ejecución; si no, `42501`.
- Identifica al titular por el contacto (correo o teléfono, sin distinguir mayúsculas) **y** por las
  cuentas web cuyo correo coincide (de ahí sale su `cliente_id`).
- Anonimiza sus consultas (`nombre`/`contacto` → `Anonimizado`, `mensaje` → texto neutro respetando
  el `check` de `consultas_mensaje_requerido`, `nota_interna` → `null`), marca `suprimido_en` y
  **borra sus ítems**.
- Vacia la `nota` de sus presupuestos de la tienda y los marca. **No toca el comprobante.**
- Limpia la cola: borra los avisos de esas consultas que aún no se enviaron y les saca a las
  enviadas las claves con datos personales.
- Deja el evento `tienda.titular_suprimido` (nuevo tipo en `public.tipos_evento_actividad`) con las
  cantidades y **sin datos personales**.

### 5. Flow de Kestra `purgar-consultas-tienda`

Copia de `purgar-api-llamadas.yml`: trigger `Schedule` diario, rol `kestra_orquestacion`, una sola
tarea `Query` que llama `private.purgar_consultas_tienda(CAST(:retencion AS integer))` con el plazo
de `TIENDA_CONSULTAS_RETENCION_DIAS` (180 por defecto) y un subflow de aviso de fallo. La variable
se declara en `infra/kestra/.env.example` y en el Compose (`infra/kestra/compose.yaml`), como la
retención de la API.

## Validación

- pgTAP nuevo `supabase/tests/database/consultas_retencion.test.sql`: privilegios, política de
  purga (qué se borra y qué no), cascada de ítems y de avisos, idempotencia, invalidación del
  plazo, supresión (qué queda neutralizado, qué se borra, qué no se toca), aislamiento por
  organización, `42501` de los roles sin permiso y el evento de actividad sin datos personales.
- Mutantes (FEAT-236): se prueba que los tests fallan si se cambia `estado <> 'en_curso'` por
  `true`, si se saca la cascada de los avisos o si la supresión copia el contacto a la actividad.
- `pnpm test:kestra:purgar-consultas-tienda` (contrato estático del flow), `pnpm der:check`,
  `pnpm docs:check`, `node scripts/verificar-migraciones.mjs --base origin/dokploy`, `pnpm lint` y
  `pnpm build`.

## Riesgos y despliegue

- **Irreversible**: los datos personales borrados no se recuperan salvo desde un backup. Mitiga que
  la purga solo toque lo vencido y lo que no está en curso, y que avise por actividad.
- **La primera corrida** borra todo lo que ya venció desde que existe la tienda: el equipo debe
  avisar a los operadores y exportar antes si quiere el histórico (la exportación total ya incluye
  `dominio.consultas`, `dominio.consulta_items` y `dominio.presupuestos_tienda`).
- **Orden**: la migración va antes que el flow; el flow empieza a purgar al día siguiente de
  desplegarlo.
- **Reversión**: encabezado de la migración (columnas, funciones y flow); revertir el PR no deshace
  lo ya aplicado en la base.
