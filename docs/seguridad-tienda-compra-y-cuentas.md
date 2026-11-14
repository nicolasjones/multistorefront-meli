# Revisión de seguridad · Tienda: compra y cuentas (MSF-176)

Registro de las revisiones de seguridad de la épica **MSF-176** (spec `specs/20270306-100000-tienda-compra-y-cuentas/`). La guía funcional es [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md); acá solo va lo que importa para seguridad. La revisión de seguridad **integral** de las tres historias (tarea T070 de `tasks.md`) la hizo una sesión que no implementó y está al final de este documento; sus hallazgos se corrigieron en el PR de cierre (`feat/MSF-176-cierre-hallazgos`).

## B2 · Presupuesto desde la tienda (tarea T062)

- **Revisado**: PR #964 hasta el commit `528b6cfb` (la historia B2 completa más la etapa 1, el cálculo de precio sin sesión de panel), por una sesión independiente de la que implementó, con el modelo de amenazas 2.x de la spec.
- **Veredicto: Aprobado, sin hallazgos.** La revisión de código y seguridad dejó observaciones menores (M-1 a M-4 y la información I-1 a I-5), todas corregidas o decididas en commits posteriores (abajo).
- **Etapa 1 (T052)**: revisión previa del refactor de precio sobre `088a1988`, con hallazgos menores corregidos en `beaa8234` (S1, S2, T1, T3).

### Barreras revisadas (amenazas 2.1 a 2.12)

| # | Amenaza | Barrera | Prueba |
|---|---|---|---|
| 2.1, 2.11 | IDOR / mezcla de datos | `crear_presupuesto_tienda` y `cotizar_presupuesto_tienda` no reciben cliente, cuenta, empresa ni organización: todo sale de `private.cuenta_de_tienda(host)` (auth.uid(), cuenta activa y habilitada en la tienda del host); el motor recibe la cuenta y saca de ella cliente, tipo y descuento con la organización de la empresa | pgTAP (a), (b), (c) |
| 2.2, 2.3 | Usuario sin cuenta, otra tienda u otra organización | `sin_acceso` idéntico en 15 casos (anónimo sin execute, panel, suspendida al instante, no habilitada, cuenta de otra tienda y de otra organización, host desconocido, pausado, bandera apagada) | pgTAP (b), (m); E2E |
| 2.4 | Precio manipulado | Ninguna clave ajena del `jsonb` se lee; precio, escala, descuento, depósito, estado, canal, fecha e instante salen del servidor (`clock_timestamp()`, descuento siempre aplicado); paridad de todas las columnas con el panel | pgTAP (c), (d) |
| 2.5 | Presupuestos basura | 5 por día y 10 abiertos por cuenta con lock; cupo de llamadas por cuenta antes de calcular; cupo por hora por IP de la tienda | pgTAP (g); E2E (concurrencia real) |
| 2.6 | Doble creación | Única `(cuenta, clave_envio)`; reintento devuelve el mismo presupuesto | pgTAP (h); E2E |
| 2.7 | Efectos de dinero o stock | La función no llama a stock, reservas, cobros ni contrarreembolsos; estado fijo `pendiente` | pgTAP (f); E2E |
| 2.8 | Escalada por `security definer` | `search_path = ''`, sin SQL dinámico, `anon` sin `execute`, helpers `private` sin `execute` de API, tabla sin escritura por la API | pgTAP (j), (k); `tienda_capacidades` |
| 2.9 | Auditoría | Evento `presupuesto.creado_desde_tienda` (actor nulo; número, tienda y cliente; sin correo ni teléfono) y vínculo con cuenta y clave | pgTAP (n) |
| 2.12 | Numeración fuera de la transacción | El número se toma dentro de la sub-transacción: un error provocado deja el contador sin cambio | pgTAP (i) |
| 1.4 | Enumeración de productos | Oculto, inactivo, ajeno e inexistente dan la misma respuesta | pgTAP (1.4) |

### Observaciones menores y su resolución

- **M-1** (origen «Tienda online»): se deriva del vínculo real `dominio.presupuestos_tienda`, no de `canal` + operador nulo; también en `obtener_comprobante` y en la consulta del listado y el CSV de comprobantes (migraciones `…100500` y `…100600`).
- **M-2**: la misma regla en Ventas › Comprobantes y su CSV (`private.comprobantes_consulta`) y en `obtener_comprobante.operador`.
- **M-3**: el cupo de llamadas sobrevive a una excepción (se toma antes del bloque con el manejador).
- **M-4**: recorte de la nota con espacios, tabuladores y saltos de línea; mismo conjunto de caracteres bloqueados (U+061C, U+200B a U+200D, U+2060, U+FEFF y los anteriores) en B1, B2 y el front (migración `…100700`).
- **I-1 a I-5**: documentadas en [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md#revisión-independiente-correcciones-m-1-a-m-4-y-decisiones-i-1-a-i-5): cupo por IP compartido, costo medido del catálogo efectivo (5.000 productos: 7 a 12 ms; motor de 50 líneas 43 a 48 ms), idempotencia con total actual, 10 abiertos sin vencimiento automático y retención y supresión (MSF-944).

### Seguimientos

MSF-940 (aviso al equipo), MSF-941 (presupuesto desde una consulta de pedido), MSF-942 (filtro por canal), MSF-943 (validez por defecto) y MSF-944 (retención y supresión de consultas, ítems de pedido y presupuestos de la tienda).

## Revisiones de A y B1 (tareas T025, T026, T046 y T047)

- **Historia A («Mi cuenta»)**: revisión independiente de QA y de código y seguridad sobre `3e4595d3`, con hallazgos corregidos en `d05345fc` (mergeada en #956).
- **Historia B1 (lista de pedido)**: revisión independiente de QA y de seguridad y código sobre `5f45af36`, con hallazgos corregidos en `18ea5892` (mergeada en #963).

## Revisión de seguridad integral (tarea T070)

- **Revisado**: `dokploy` en `f586e544` (A, B1 y B2 completas, con el refactor de precio), por una sesión independiente de las que implementaron, contra las tablas 1, 2 y 3 del modelo de amenazas de la spec.
- **Veredicto: con hallazgos, solo menores** (H-1 a H-6). Se corrigieron en el PR de cierre `feat/MSF-176-cierre-hallazgos`, con migraciones nuevas `20270322200000` a `20270322200400` (las anteriores ya están en `dokploy` y son inmutables), pgTAP (`tienda_cierre_hallazgos.test.sql`) y Vitest.

| # | Hallazgo | Resolución |
|---|---|---|
| H-1 | El hash de IP que usan los cupos (`private.visitante_hash` / `visitante_publico`) es reversible por fuerza bruta (IPv4 sin sal secreta). Heredado de la tienda previa. | **Seguimiento: MSF-945** (agregar un secreto del servidor al hash). No se corrige en este PR; la IP nunca se guarda en claro y el hash no sale de la base. |
| H-2 | `presupuestos_tienda_cuenta_fk` era `on delete cascade`: dar de baja una cuenta (la fusión de clientes la elimina con un `delete`; también borrar el usuario de Auth) borraba el vínculo del presupuesto (rótulo «Tienda online (cliente)», nota y topes). Además `fusionar_clientes` dejaba `presupuestos_tienda.cliente_id` y `consultas.cliente_id` apuntando al cliente archivado. | La columna admite nulo y la FK pasa a `on delete set null (cuenta_cliente_id)`; la fusión repunta ambas columnas al conservado (última versión vigente de la función más el cambio). pgTAP: borrar la cuenta conserva vínculo, nota y rótulo; la fusión repunta. Como la baja de una organización dejaba de arrastrar el vínculo por el camino de la cuenta y bloqueaba el borrado (los controles `no action` de cliente y comprobante se evalúan al terminar cada borrado en cascada), esas dos FK pasan a `on delete cascade`: el cliente archivado por la fusión no se borra y un comprobante no se borra en el flujo normal. pgTAP: borrar al usuario de Auth conserva el vínculo y la baja de la organización con presupuestos funciona. `dominio.favoritos_cliente` sigue en cascade (son datos privados de la cuenta). |
| H-3 | Las cinco RPC de «Mi cuenta» (A) no tenían cupo de llamadas. | Cupo de 120 por minuto y cuenta (clave por cuenta) tomado después de resolver la cuenta y antes de cualquier lectura, fuera del bloque con el manejador; respuesta `{estado: limite, espera_segundos}` que el front traduce a su error con reintento. `favoritos_entre_por_dominio` pasa de `stable` a `volatile`. pgTAP y Vitest. |
| H-4 | El cupo de la lista de pedido y del envío (B1) se revertía con una excepción. | Se toma antes del bloque anidado con `exception when others`, como en B2. pgTAP (falla provocada: el cupo igual se gasta y la cuarta llamada responde `limite`). |
| H-5 | Funciones `private` concedidas a `authenticated`. | Documentado abajo. |
| H-6 | El script de medición escribía sin guard; faltaban caracteres invisibles en las listas bloqueadas. | `scripts/medir-tienda-favoritos.sql` aborta salvo `-v BASE_DESCARTABLE=si` y con más de 5 organizaciones. Se suman U+00AD, U+180E y U+2061 a U+2064 a las listas de SQL (`enviar_lista_pedido`, `crear_presupuesto_tienda`) y del front, con el mismo conjunto. |

### H-5: funciones de `private` concedidas a `authenticated`

`private.precio_para` (ahora `security definer`), `private.numero_cliente_consulta` y `private.nombre_cliente_consulta` tienen `execute` para `authenticated`. Es seguro **solo porque el esquema `private` no está expuesto por PostgREST**: `supabase/config.toml` (`[api] schemas = ["public", "graphql_public", "dominio", "publico"]`) y `.env.example` (`SUPABASE_API_SCHEMAS`). En el Supabase self-hosted de dev, staging y producción esa lista es `PGRST_DB_SCHEMAS`: hay que **verificar que no incluya `private`** al desplegar y cada vez que se toque la configuración de PostgREST (ver `docs/tiendas-online.md`). Además:

- `precio_para` y `precio_linea_venta` se apoyan en `private.precio_sesion_alcanza`, que valida la **organización** de la sesión y que la sesión tenga `empresas` o `ventas`, pero **no el acceso a la empresa concreta** dentro de la organización (una persona de la organización con acceso a otra tienda ve el precio de productos de esa otra tienda). Es coherente con lo que ya hacían las funciones de las que se extrajo (los llamadores `security definer` validan la empresa del comprobante) y no se expone por la API; queda dicho para quien agregue un llamador nuevo.
- Quien cree una función `private` nueva debe revocar `execute` de `public`, `anon` y `authenticated` (las migraciones de esta épica lo hacen y los pgTAP de superficie lo verifican).

### H-4: `statement_timeout` (57014)

El cupo sobrevive a un error capturado por `exception when others`, **pero PostgreSQL excluye `query_canceled` (57014) de `others`**: si una llamada excede el `statement_timeout` de su rol (`anon` 3 s, `authenticated` 8 s) la llamada falla entera, su transacción se revierte **con el incremento del cupo** y el cliente recibe el error de PostgREST (sin datos internos: solo el aviso de que se canceló la consulta). Se evaluó atrapar `query_canceled` por nombre y se descartó (es una trampa frágil: el temporizador ya se disparó y la sentencia sigue consumiendo). La protección frente a esa vía es el propio `statement_timeout`, que acota el costo de cada llamada (el motor de 50 líneas tarda unos 45 ms con 5.000 productos), más el límite del proxy delante de PostgREST. Queda como observación, sin cambio de código.

### Seguimientos de seguridad

MSF-945 (hash de IP con secreto del servidor, H-1) además de MSF-940 a MSF-944 (ver arriba).
