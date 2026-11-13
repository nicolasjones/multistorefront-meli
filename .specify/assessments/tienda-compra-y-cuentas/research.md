# Idea Research: Tienda · compra online y cuentas de clientes

- **Slug**: tienda-compra-y-cuentas
- **Created**: 2026-11-13
- **Evidence confidence (overall)**: medium en lo que existe en el código (verificado en `origin/dokploy`); low en demanda y negocio (sin evidencia del cliente)

Rutas relativas a la raíz del repo. Líneas verificadas en `origin/dokploy` el 2026-11-13.

## Users & Demand

- Las tiendas no cobran en línea; la venta se cierra por WhatsApp, correo o en el local — [source: tracker MSF-154/MSF-176 «Supuestos»] (confidence: high, cited)
- Ninguna de las dos épicas tiene requisitos, pantallas ni horas; ambas son P3 «fuera» del alcance acordado — [source: tracker] (high, cited)
- **No hay evidencia de demanda** de compra online (ni pedido del cliente, ni métricas de consultas que no cierran). Las épicas dicen «solo se retoma si el cliente confirma demanda» — [source: tracker MSF-154] (high que la condición existe; demanda: ASSUMPTION)
- Hay datos propios para medir demanda sin construir: `dominio.consultas` guarda consultas del formulario y de WhatsApp (`supabase/migrations/20261205100000_consultas.sql:22`) y `publico.registrar_interes_whatsapp` registra clics (`supabase/migrations/20261214100100_registrar_interes_whatsapp.sql:17`). Nadie los analizó para esta evaluación — [source: código] (medium)

## Prior Art

### Cuenta web del cliente: YA EXISTE (épica MSF-237, estado «Review In DEV»; historia F-CLI-05 MSF-422 «Finalizada»)

- Tabla `public.cuentas_cliente`, una fila por (cliente, tienda): `supabase/migrations/20261211100000_cuentas_cliente.sql:23`. Estados `activa|suspendida`; RLS solo para panel (política en ese archivo); la cuenta no es miembro del panel.
- RPC de gestión: `preparar_cuenta_cliente` (`20261211100100_cuentas_cliente_rpc.sql:59`), `vincular_cuenta_cliente` (`:115`), `cambiar_estado_cuenta_cliente` (`:188`), `cuentas_web_de_cliente` (`:237`).
- Acceso en la tienda: `publico.acceso_cliente_por_dominio(host)` (`20261211100200_acceso_cliente_por_dominio.sql:16`); precios por escala: `publico.precios_cliente_por_dominio` (`20261211110100_precios_cliente_por_dominio.sql:21`).
- Edge Functions: `supabase/functions/invitar-cliente/handler.ts`, `supabase/functions/recuperar-clave-cliente/`.
- Front público: `apps/web/src/pages/tienda-publica/rutas/ingresar.tsx`, `definir-contrasena.tsx`, `recuperar-contrasena.tsx`; `apps/web/src/hooks/useSesionCliente.ts:10`; `apps/web/src/pages/tienda-publica/layout/AccesoCliente.tsx:9`; `apps/web/src/hooks/usePreciosCliente.ts:8`; `apps/web/src/pages/tienda-publica/ficha/PreciosCliente.tsx`.
- Panel: `apps/web/src/components/clientes/BloqueCuentaWeb.tsx`, `apps/web/src/hooks/useCuentasWebDeCliente.ts`.
- Spec: `specs/20261024-051500-cuenta-web-del-cliente/spec.md` (solo invitación, sin auto-registro: supuesto D2; una fila por tienda: D1; las tiendas «no cobran en línea»).
- **No existe** una página «Mi cuenta» en la tienda: las rutas son solo ingresar, definir y recuperar contraseña (`apps/web/src/pages/tienda-publica/rutas/`).

### Favoritos e historial: NO EXISTEN

- `grep -i favorit` sobre `apps/`, `supabase/`, `workers/`: solo menciones documentales (specs y docs), ningún código ni tabla.
- Historial de compras: existe del lado del panel (`public.compras_de_cliente`, `supabase/migrations/20261018100200_clientes_compras.sql:16`, versión vigente `20261212120500_facturado_neto_notas.sql:133`, hook `apps/web/src/hooks/useComprasCliente.ts`), no expuesto a la cuenta web. Es una base reutilizable, no una función ya hecha.
- F-CLI-20 (MSF-452 «Historial y favoritos en la cuenta web», P3) **ya es la historia que cubre esto** y declara: «Equivale a F-CON-07 y F-TDA-27 del documento general, que quedan acotados a esta historia». Sin requisitos (`specs/20261029-100000-cuentas-y-compras-a-proveedores/tasks.md`, T002). En el tracker figura en «En curso» sin requisitos: [NEEDS CLARIFICATION: ¿es correcto ese estado?].

### Consulta de la tienda (lo que hay hoy en lugar de comprar)

- Formulario de contacto: `apps/web/src/pages/tienda-publica/contacto/FormularioContacto.tsx` → `publico.enviar_consulta_contacto` (`supabase/migrations/20261212120700_tienda_contacto.sql:248`): resuelve la empresa por host, valida, aplica límite e idempotencia (`private.registrar_envio_tienda`, `:108`) y entrega a la bandeja (`private.entregar_a_bandeja`, `:158`).
- Botón WhatsApp en la ficha: `apps/web/src/pages/tienda-publica/whatsapp/BotonWhatsApp.tsx`, usado desde `ficha/DatosProducto.tsx`; registra la consulta con `publico.registrar_consulta_whatsapp` (`20261212121000_tienda_whatsapp.sql:26`, front `apps/web/src/lib/registroWhatsapp.ts:77`).
- Alta genérica: `publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje, producto_id)` (`20261205100100_crear_consulta_publica.sql:14`), origen `formulario|whatsapp`, un único producto por consulta, sin cantidades.
- Bandeja del panel: `apps/web/src/pages/consultas/list.tsx`, estados `nueva|en_curso|resuelta`; es «solo un registro, la respuesta se da fuera del sistema» (`docs/consultas.md:9`).
- Contactos y respuestas rápidas (MSF-144, «Review In DEV»): `dominio.contactos` con consentimiento (`20270201100000_contactos.sql:23`), `dominio.respuestas_rapidas` (`20270201200000_respuestas_rapidas.sql:20`).

### Ventas internas (base para un pedido online)

- Comprobantes: `public.crear_comprobante` (`20261203100400_comprobantes_rpc.sql:101`) exige sesión de panel con organización; el canal `tienda_online` **ya es un valor válido** (`20261203100100_comprobantes_cabecera.sql:64`); `cliente_id` es obligatorio (`20261018100000_ventas_contrato_comprobantes.sql:23`; el spec prevé «Consumidor final» como dato sembrado por organización (verificar que exista) según `specs/20261023-100000-ventas-comprobantes/spec.md`). Líneas: `dominio.comprobantes_venta_lineas` (`20261203200100_comprobantes_lineas.sql:18`). Presupuesto → `aceptar_presupuesto` (`20261204150000_aceptar_presupuesto.sql:37`), factura → `confirmar_comprobante` (`20261204140000_confirmar_comprobante.sql:37`).
- Estados y transiciones por rol: `dominio.transiciones_estado_comprobante` (`20261212100500_comprobante_transiciones_estado.sql:18`), `cambiar_estado_comprobante` (`20261212100700`), estado de cobro (`20261212100800`).
- Cobros y conciliación manual: `dominio.cobros_comprobante` (`20270114100000_cobros_comprobante.sql:48`), `dominio.contrarreembolsos` (`20270114120000_contrarreembolsos.sql:50`); catálogos `formas_pago` (`20261020100000_formas_pago.sql:20`), `formas_envio` (`20261022120100:20`), `cuentas_cobro` (`20261022120300:21`), `transportes` (`20261022120700:30`). Docs: `docs/ventas-cobros-y-conciliacion.md`, `docs/pagos-conciliacion.md`, `docs/ventas-despacho.md`.
- Stock: `public.reservar_stock` (`20261023130100_stock_reservas.sql:86`) solo para productos «A pedido» y exige permiso de edición de stock (no invocable por un visitante); la factura confirmada descuenta (spec ventas-comprobantes, «Stock»). Disponibilidad pública solo booleana: `20261023150100_tienda_disponibilidad_publica.sql`; la tienda decidió **no exponer cantidades** («Últimas unidades» fuera de alcance, `docs/tiendas-online.md:636`).
- Pantallas del panel: `apps/web/src/pages/ventas/presupuestos.tsx`, `comprobante.tsx`, `comprobantes.tsx`, `mostrador.tsx`, `despacho.tsx`, `faltantes.tsx`.

### Pagos y facturación fiscal: NO EXISTEN

- No hay pasarela de pago ni integración con proveedor de pagos en `apps/`, `supabase/`, `workers/` (los hits de «checkout» son de CI/Git).
- No hay integración con ARCA: **los comprobantes son internos, no fiscales** (`specs/20261024-130000-ventas-despacho-y-faltantes/spec.md:33`, `specs/20261023-100000-ventas-comprobantes/spec.md:33`). Mercado Libre queda para Etapa 2 (`20261203100100_comprobantes_cabecera.sql:57`).
- Los cobros actuales son **registros manuales** de lo que el personal recibió (cuentas de cobro con datos bancarios, ~70 según `specs/20261020-100000-ventas-catalogos-de-cobro-y-envio/spec.md`).

### Estado de las épicas bloqueantes (tracker, 2026-11-13)

| Épica | Estado | Lectura |
|---|---|---|
| MSF-167 Tienda catálogo y ficha | Review In DEV | En el flujo, terminada: catálogo y ficha existen |
| MSF-237 Cuenta web del cliente | Review In DEV (F-CLI-05 MSF-422 Finalizada) | Existe; cubre acceso y precios por escala |
| MSF-144 Contactos y respuestas rápidas | Review In DEV | Existe el modelo de contactos |
| MSF-176 / MSF-154 | Ready For Spec; historias en Backlog | Sin requisitos, sin hito |

Los bloqueos formales de MSF-154 (MSF-144 y MSF-176) y de MSF-176 (MSF-167) quedan **resueltos** salvo que MSF-176 (F-TDA-26) siga sin hacerse; el vínculo MSF-176 bloquea MSF-154 es de dirección correcta tras la corrección del tracker. Anomalía: **F-TDA-27 declara estar bloqueada por F-CON-07**, que vive en MSF-154, bloqueada a su vez por MSF-176 (que contiene a F-TDA-27): dependencia circular entre historias.

## Market & Context

- Alternativa actual del cliente: WhatsApp, correo o local — [source: tracker] (cited). Costo de no hacer: seguir cerrando fuera del sistema, sin trazabilidad desde la consulta hasta el comprobante. Cuánto duele: [ASSUMPTION / NEEDS CLARIFICATION].
- El rubro de San Javucho/Mundo JC (videojuegos, 2 tiendas, mayorista y minorista) — [source: contexto del proyecto]: se vende con consulta de disponibilidad, precios por escala y coordinación de envío; esto sugiere que el pedido sin cobro encaja más que un checkout cerrado. Es una inferencia (ASSUMPTION).

## Data & Constraints

- Constitución, Principio VII: toda tabla nueva declara esquema (`public` plataforma / `dominio` negocio); CLAUDE.md: RLS en toda tabla expuesta, nunca la service-role en el navegador, toda estructura en migración.
- La superficie anónima de la tienda son funciones `publico.*` `security definer` sin tablas; empresa siempre derivada del host (patrón de `crear_consulta_publica`). Cualquier pedido online debe seguir ese patrón y el límite por envío de `registrar_envio_tienda`.
- Datos personales: `consultas.contacto` y `contactos` ya guardan correo/teléfono; `contactos` tiene consentimiento y anonimización. Un carrito/pedido con cuenta sumaría dirección, historial y posiblemente DNI/CUIT: requisitos de privacidad a validar con el cliente (marco legal argentino: ASSUMPTION, no verificado).
- Precio por escala depende de la cantidad total de la línea y del tipo de cliente (`private.precio_para`); la tienda ya lo calcula por cuenta activa.

## Evidence Against the Idea

- No hay demanda documentada; las épicas se retoman «solo si el cliente confirma demanda».
- F-TDA-27 y F-CON-07 son duplicados de F-CLI-20; construirlas por separado duplicaría tablas y pantallas.
- Un checkout real exige pagos, envíos, facturación fiscal, devoluciones y soporte, nada de lo cual existe; es el mayor salto de alcance y riesgo del producto, y está explícitamente fuera del alcance acordado.
- La tienda no expone cantidades de stock; un carrito con garantía de disponibilidad entra en conflicto con esa decisión y con que `reservar_stock` sea solo «A pedido» y de uso interno.
- El proceso comercial real (precio mayorista, retiro por transporte, contrarreembolso) es coordinado por personas; automatizarlo antes de entenderlo puede empeorarlo.

## Gaps & Open Questions

- [NEEDS CLARIFICATION: evidencia de demanda: consultas por semana, cuántas cierran en venta, cuántas piden pagar a distancia]
- [NEEDS CLARIFICATION: ¿se acepta que F-TDA-27 y F-CON-07 se fusionen en F-CLI-20?]
- Preguntas de negocio completas en `decision.md`.

## Sources

- tracker plan.agenmatica.com: MSF-154, MSF-176, MSF-284, MSF-334, MSF-341, MSF-452 (API del tracker, host propio)
- Código y specs del repo en `origin/dokploy` (rutas arriba)
