---
owner: plataforma
sources:
  - specs/20270306-100000-tienda-compra-y-cuentas
---

# Revisión de seguridad · Tienda: compra y cuentas (MSF-176)

Registro de las revisiones de seguridad de la épica **MSF-176** (spec `specs/20270306-100000-tienda-compra-y-cuentas/`). La guía funcional es [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md); acá solo va lo que importa para seguridad. La revisión de seguridad **integral** de las tres historias (tarea T070 de `tasks.md`) la hizo una sesión que no implementó; el cierre de sus hallazgos H-2 a H-6 (MSF-988) está al final de este documento.

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
- **I-1 a I-5**: documentadas en [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md#revision-independiente-correcciones-m-1-a-m-4-y-decisiones-i-1-a-i-5): cupo por IP compartido, costo medido del catálogo efectivo (5.000 productos: 7 a 12 ms; motor de 50 líneas 43 a 48 ms), idempotencia con total actual, 10 abiertos sin vencimiento automático y retención y supresión (MSF-944).

### Seguimientos

MSF-940 (aviso al equipo), MSF-941 (presupuesto desde una consulta de pedido), MSF-942 (filtro por canal), MSF-943 (validez por defecto) y MSF-944 (retención y supresión de consultas, ítems de pedido y presupuestos de la tienda).

## Menores retroactivos (2026-11-15)

- `private.precio_para` es `security definer` con `execute` para `authenticated`: la compuerta `private.precio_sesion_alcanza` (sin `execute` de API) y la ACL quedan fijadas por el pgTAP `precio_para_compuerta`.
- `enviar_lista_pedido` sin captcha es un **riesgo aceptado** (mitigaciones: 5 envíos por hora y por IP, 20 llamadas por minuto, idempotencia, aviso agrupado); ver 1.11 en la spec y `tienda-compra-y-cuentas.md`.
- El cupo de llamadas de la lista y del envío sobrevive a un fallo posterior (sub-bloque con manejador propio).

## Cierre de la revisión integral (MSF-988)

| # | Hallazgo | Estado |
|---|---|---|
| H-1 | El hash de IP de los cupos es reversible por fuerza bruta. | Fuera de este cambio: seguimiento MSF-945. |
| H-2 | La baja de la cuenta web borraba el vínculo del presupuesto de la tienda (FK `on delete cascade`), y `fusionar_clientes` dejaba cliente de presupuestos y consultas apuntando al cliente archivado. | `20270507300000`: `cuenta_cliente_id` admite nulo y la FK pasa a `on delete set null (cuenta_cliente_id)`; las FK de cliente y comprobante pasan a `on delete cascade` para que la baja de la organización no se bloquee. `20270507300100`: la fusión repunta `cliente_id` de `presupuestos_tienda` y `consultas`, y pasa los presupuestos de la cuenta que se da de baja a la cuenta que sobrevive de la misma empresa (si la `clave_envio` choca, ese vínculo queda sin cuenta). El repunte de consultas hace avanzar su `updated_at`. |
| H-3 | Las cinco RPC de «Mi cuenta» no tenían cupo de llamadas. | `20270507300200`: 120 llamadas por minuto y cuenta (`private.limite_llamadas_cuenta_por_minuto()`), tomadas después de resolver la cuenta y antes de leer, fuera del bloque con `exception when others`. Superado, responde `{estado: limite, espera_segundos}`; el front lo trata como error con reintento. Las cuatro que eran `stable` pasan a `volatile`. Quedan fuera de este cierre `acceso_cliente_por_dominio` y `precios_cliente_por_dominio` (sin cupo por cuenta, `stable`) y `mis_opiniones_por_dominio` (cupo por visitante, no por cuenta); decisión de diseño pendiente de Nicolás. |
| H-4 | El cupo de la lista de pedido y del envío se revertía con una excepción. | Ya estaba corregido en `20270430000000_tienda_menores_revision.sql`; `tienda_cierre_hallazgos.test.sql` lo vuelve a probar. |
| H-5 | Funciones de `private` con `execute` para `authenticated`. | Documentado abajo; sin cambio de código. |
| H-6 | El script de medición escribía sin guard de entorno y faltaban caracteres invisibles en las listas bloqueadas. | `20270507300300`: se suman U+00AD, U+180E y U+2061 a U+2064 en `enviar_lista_pedido` y `crear_presupuesto_tienda`; `tiendaPedido.ts` usa el mismo conjunto. `scripts/medir-tienda-favoritos.sql` aborta salvo que se pase `-v BASE_DESCARTABLE=si`, la sesión sea superusuario (el conteo no depende de RLS), el nombre de la base tenga `descartable`, `test` o `local` como palabra delimitada por `_` o `-` (`medicion_descartable` cumple, `latest` no; `local_prod` también cumple) y la base tenga 5 organizaciones o menos. Es una protección contra accidentes, no un control de seguridad: quien accede a la base puede saltearla. Prueba: `scripts/medir-tienda-favoritos.guard.test.mjs` (se omite sin `MEDIR_PSQL` y `MEDIR_PSQL_OTRA_BASE`; no corre en el CI porque el job `database` usa la base `postgres` del stack de Supabase, que tiene conexiones de los servicios y no se puede clonar como plantilla, y su nombre no cumple el guard: corre local con las variables). |

Las migraciones se derivan de las definiciones vigentes al momento del cambio (no de las del PR #1128, anterior a varios cambios de la base). Las funciones nuevas o reemplazadas siguen con `security definer` y `search_path` vacío.

### H-5: funciones de `private` con `execute` para `authenticated`

`private.precio_para`, `private.numero_cliente_consulta` y `private.nombre_cliente_consulta` son `security definer` y tienen `execute` para `authenticated`, igual que otras funciones de `private`. Es aceptable mientras PostgREST no exponga el esquema `private`: la lista de esquemas de `supabase/config.toml` (`[api] schemas`) y de `.env.example` (`SUPABASE_API_SCHEMAS`) no lo incluye. En los entornos self-hosted esa lista es `PGRST_DB_SCHEMAS` (ver `tiendas-online.md`): al desplegar y cada vez que se toque la configuración de PostgREST hay que comprobar que no incluya `private`.

- `precio_para` se apoya en `private.precio_sesion_alcanza`, que valida la organización de la sesión y que tenga `empresas` o `ventas`, pero no el acceso a la empresa concreta. Quien agregue un llamador nuevo debe validar la empresa.
- Una función nueva de `private` debe revocar `execute` de `public` y `anon`, y conceder `authenticated` si una política o una RPC de la sesión la necesita.

### `statement_timeout` (57014)

`exception when others` no atrapa `query_canceled` (57014). Si una llamada excede el `statement_timeout` de su rol (el comentario de `20270321100200` anota `anon` 3 s y `authenticated` 8 s), la llamada falla entera y su transacción se revierte, con el incremento del cupo incluido; el cliente recibe el error de PostgREST.
