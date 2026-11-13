# Concept: Tienda · compra online y cuentas de clientes

- **Slug**: tienda-compra-y-cuentas
- **Created**: 2026-11-13
- **Recommended option**: B1 (pedido sin cobro como consulta con ítems), precedida por A; C no se recomienda hoy

Tallas por analogía con lo ya entregado: la épica cuenta web (F-CLI-05 L + F-CLI-06 S + F-CLI-07 M, todas P0) se estimó en ~28 h (`specs/20261024-051500-cuenta-web-del-cliente/spec.md`). Las estimaciones de abajo son relativas, no compromisos; el tracker no tiene horas para estas épicas.

## Options

### Option A — Cuentas mínimas: «Mi cuenta» con historial y favoritos, sin pagos
- **Sketch**: el cliente con cuenta web activa entra a «Mi cuenta» en la tienda: ve sus compras/presupuestos de esa tienda (solo lectura, número, fecha, estado, total) y guarda productos como favoritos que ve en una lista. Se construye sobre `cuentas_cliente`, `acceso_cliente_por_dominio` y `compras_de_cliente`; el alta sigue por invitación. F-TDA-27, F-CON-07 y F-CLI-20 se funden en una sola historia.
- **Appetite**: medium (≈ 1 spec; 1 función `publico` de historial con recorte de campos, 1 tabla `dominio` de favoritos con RLS por cuenta, 1 página).
- **Trade-offs**: gana: sin riesgo de pagos, reutiliza todo, elimina duplicados del tracker. Sacrifica: no cambia cómo se vende; el valor depende de que haya clientes con cuenta (¿cuántas cuentas se crearon?).
- **Rabbit holes**: exponer en historial datos internos (costos, notas, estados internos de despacho); «favoritos» de visitantes sin cuenta (auto-registro/localStorage: fuera); historial de compras hechas fuera de la tienda (mostrador) mezclado con pedidos online; clientes con varias tiendas (D1 de cuenta web).

### Option B — Pedido online sin cobro
Dos variantes de profundidad; ambas dejan el cierre (pago, envío, factura) fuera del sistema, como hoy.

**B1 — Consulta con ítems («lista de pedido»)**
- **Sketch**: el visitante (con o sin cuenta) agrega productos con cantidad a una lista y la envía con nombre y contacto. Llega a la bandeja de Consultas como una consulta estructurada (ítems, cantidades, precio de lista/escala mostrado como referencia) y se responde por WhatsApp o correo como hoy. El operador puede crear el presupuesto desde ahí en el panel.
- **Appetite**: medium.
- **Trade-offs**: gana: valida demanda con poco riesgo, usa el circuito de bandeja y anti-spam existentes, no promete stock ni precio firme. Sacrifica: sigue habiendo transcripción manual a presupuesto (se puede mitigar con un botón «Crear presupuesto» en el panel, ya cercano a `crear_comprobante`); no hay estado de pedido para el cliente.
- **Rabbit holes**: múltiples líneas en `dominio.consultas` (hoy un solo `producto_id`, `20261205100000_consultas.sql:22`) obliga a tabla de ítems; precios mostrados vs. vigentes al responder; abuso/spam con listas largas (reutilizar `registrar_envio_tienda`); expectativa del cliente de que «ya compró».

**B2 — Presupuesto real desde la tienda**
- **Sketch**: el cliente **con cuenta activa** envía el carrito y se crea un presupuesto `pendiente` (canal `tienda_online`, ya válido) a su nombre; ve el estado en «Mi cuenta» (A) y el operador lo acepta/convierte con los flujos actuales.
- **Appetite**: large.
- **Trade-offs**: gana: trazabilidad completa consulta→presupuesto→factura, reutiliza numeración, escalas e historial. Sacrifica: obliga a cuenta (se pierde el visitante anónimo) o a una política de «cliente provisorio»; requiere una función pública nueva que cree comprobantes sin sesión de panel (hoy `crear_comprobante` exige organización en el JWT, `20261203100400_comprobantes_rpc.sql:101`): superficie sensible.
- **Rabbit holes**: operador/numeración/auditoría sin operador humano (`operador_id` nulo); presupuestos basura que ensucian numeración y reportes; validez (`valido_hasta`); precios congelados; stock «A pedido» y reservas (`reservar_stock` exige permiso de stock, `20261023130100_stock_reservas.sql:86`) — en B2 **no se reserva**; conflicto con permisos y con reportes de ventas.

### Option C — Checkout completo con pagos y envíos (F-TDA-26 tal como está titulada)
- **Sketch**: carrito persistente, elección de envío, pago con pasarela, confirmación, factura y seguimiento del pedido; stock descontado/reservado automáticamente.
- **Appetite**: large (la mayor del producto; el tracker mismo la rotula XL y pide «specs separadas de carrito, pagos, envíos, facturación y pedidos»: ≥ 5 specs; orden de magnitud por analogía, varias veces la cuenta web).
- **Trade-offs**: gana: venta sin intervención humana. Sacrifica: todo lo que hoy es manual (cobro, conciliación, despacho, devoluciones) pasa a ser automático y con responsabilidad legal y de soporte propia.
- **Rabbit holes**: pasarela y credenciales por tienda; webhooks idempotentes y conciliación con `cobros_comprobante`; cotización de envío vs. `formas_envio`/`transportes` manuales; facturación fiscal con ARCA (hoy no existe; comprobantes internos); reservas y sobreventa con stock sin exponer; devoluciones y derecho de arrepentimiento (marco legal: validar); IVA por categoría y escalas con cantidades; antifraude y contracargos; cuentas obligatorias vs. invitados; datos personales y de pago.

## Recommendation

1. **No encarar C** ahora. No hay demanda confirmada, está explícitamente fuera del alcance acordado y es la opción de mayor riesgo.
2. **Hacer A solo como F-CLI-20 acotada** (una historia) y cerrar F-TDA-27 y F-CON-07 como duplicadas, si Nicolás confirma que hay clientes con cuenta que lo usarían.
3. **Si el cliente confirma que quiere pedir en línea, empezar por B1** (valida el comportamiento real con costo medio y sin pagos) y recién después evaluar B2; C solo con evidencia de B1.
4. Antes de cualquier spec: medir con `dominio.consultas` (cantidad, origen, productos) y preguntar a los dueños (ver preguntas en `decision.md`).

## Out of Scope (for the recommended option)

- Pagos, cobros automáticos, cotización de envío, facturación ARCA, reservas de stock desde la tienda.
- Auto-registro público y cuentas de visitantes sin invitación.
- Mercado Libre; carrito persistente entre dispositivos; cupones/promociones en carrito.

## Assumptions to Validate

- Hay clientes con cuenta web activa suficientes para justificar A (hoy no sé cuántas cuentas existen en producción).
- Los dueños prefieren coordinar el cierre por WhatsApp (el tracker lo dice como hecho actual, no como preferencia).
- El precio mostrado en el carrito es solo referencia (si fuera firme, B pasa a B2/C).
- La orden del operador (presupuesto desde consulta) es un paso manual aceptable en B1.
