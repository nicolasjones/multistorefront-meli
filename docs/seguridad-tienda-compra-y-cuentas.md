---
owner: plataforma
sources:
  - specs/20270306-100000-tienda-compra-y-cuentas
---

# Revisión de seguridad · Tienda: compra y cuentas (MSF-176)

Registro de las revisiones de seguridad de la épica **MSF-176** (spec `specs/20270306-100000-tienda-compra-y-cuentas/`). La guía funcional es [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md); acá solo va lo que importa para seguridad. La revisión de seguridad **integral** de las tres historias (tarea T070 de `tasks.md`) la hace una sesión que no implementó y se agrega a este documento antes del cierre de la épica.

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
