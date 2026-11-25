---
owner: tecnico
sources:
  - apps/web/src/lib/mensajeErrorBase.ts
  - apps/web/src/lib/ventasPresupuestos.ts
  - apps/web/src/lib/facturasElegibles.ts
  - apps/web/src/components/ventas/DialogoNuevaDevolucion.tsx
  - apps/web/src/lib/reparaciones.ts
  - supabase/migrations/20270507180000_anular_comprobante_rechaza_entregada_y_con_cobros.sql
  - supabase/migrations/20270507180500_obtener_reparacion_responde_404.sql
  - supabase/migrations/20270507310000_aceptar_presupuesto_responde_4xx.sql
  - supabase/migrations/20270507340000_comprobantes_responden_4xx.sql
  - supabase/migrations/20270507350000_despacho_y_cobros_responden_4xx.sql
  - supabase/migrations/20270507360000_catalogos_envio_y_contrarreembolsos_responden_4xx.sql
  - supabase/migrations/20270507410000_productos_proveedores_categorias_y_promociones_responden_4xx.sql
  - supabase/migrations/20270507420000_alicuotas_escalas_precios_y_proveedores_responden_4xx.sql
  - supabase/migrations/20270507430000_service_catalogos_historial_y_consultas_responden_4xx.sql
  - supabase/migrations/20270507440000_comprobantes_despacho_y_cobros_estado_responden_409.sql
  - apps/web/src/lib/ventasDespacho.ts
  - apps/web/src/lib/ventasEnvio.ts
  - apps/web/src/lib/ventasFaltantes.ts
  - apps/web/src/lib/ventas/cobros.ts
  - apps/web/src/lib/estadosComprobante.ts
  - apps/web/src/lib/anularComprobante.ts
  - apps/web/src/lib/ventas.ts
---

# Errores de negocio de las RPC y su respuesta HTTP

Lote de la auditoría MSF-647: errores de negocio que PostgREST contesta como 5xx o 4xx inconsistente
(MSF-599, MSF-654, MSF-655, MSF-638; el servidor sigue por olas), la anulación con cobros parciales (MSF-600) y «Nueva devolución»
(MSF-721).

## Qué pasa hoy

Las RPC de `public` avisan «no» al usuario con `raise exception ... using errcode = '<código>'`. PostgREST
traduce el SQLSTATE a HTTP por **clase**. La columna HTTP sale de la documentación de PostgREST y **no está verificada
contra la versión instalada** (en especial la fila `40001`):

| SQLSTATE | Uso en las RPC | HTTP de PostgREST |
|---|---|---|
| `P0002` | «no existe» / fuera de tu alcance | 500 (clase `P0`; solo `P0001` es 400) |
| `55000` | estado que no admite la acción (presupuesto vencido, comprobante cerrado…) | 500 (clase `55`) |
| `55006` | ya hay un respaldo en curso | 500 (clase `55`) |
| `54000` | tope de filas del lote o de la exportación | 413 (clase `54`) |
| `40001` | conflicto de edición (bloqueo optimista) | 500 (clase `40`) |

**El cliente ya lee `error.code`**, no el estado HTTP (`supabase-js` entrega `error.code`). Por eso la persona
ve un mensaje accionable; lo que se degrada es el monitoreo del servidor (alertas, reintentos, ruido). Casi
todas las pantallas ya traducen estos códigos en su módulo de `apps/web/src/lib` (`mensajeDeErrorComprobante`,
`mensajeDeErrorReparacion`, `mensajeDeAnulacion`, `mensajeDeErrorDespacho`, `mensajeDeRma`…).

## Criterio adoptado

1. **Normalizar en el cliente, no reescribir funciones.** Cambiar el SQLSTATE de decenas de RPC rompe a los
   clientes que ya ramifican por código (p. ej. `55000` y `40001` en Ventas y Service) y a sus pgTAP, y no hay en el
   repo el patrón `PT404`/`PT409` de PostgREST (`raise ... using errcode = 'PT409'`) que permita un 4xx sin
   cambiar de semántica. Sin ese patrón probado contra la versión instalada, no se introduce uno nuevo.
2. **Catálogo central en `lib/mensajeErrorBase.ts`**: `mensajeDeErrorBase` ahora traduce también `55000`, `55006`
   y `54000` con un texto accionable (los textos propios de cada pantalla tienen prioridad). El estado HTTP y el
   monitoreo del servidor no cambian: ver «Pendiente».
3. **Brecha concreta cerrada**: `aceptar_presupuesto` responde `55000` con «El presupuesto está vencido…» y la
   pantalla mostraba el genérico «Este comprobante ya está cerrado». `mensajeDeAceptarPresupuesto` muestra el
   texto fijo del catálogo que coincide con el de la RPC (nunca el `message` del servidor).
4. **Facturar presupuesto** (lote 39): `facturar_presupuesto` responde `55000` («Aceptá el presupuesto antes de facturarlo»,
   vencido, otro estado), `22023` (sin líneas, cliente no disponible, producto inactivo con su nombre) y `42501`.
   `mensajeDeFacturarPresupuesto` (`lib/ventasPresupuestos.ts`) muestra el texto fijo del catálogo que coincide con el de la RPC y,
   para cualquier otro mensaje, cae al catálogo general (nunca muestra el `message` desconocido del servidor).
5. **MSF-638** (`obtener_reparacion`): una reparación de una tienda inaccesible se trata como inexistente a
   propósito (no revela que existe) y la ficha, la orden y el remito ya muestran «Esa reparación ya no existe»
   (`mensajeDeErrorReparacion`, código `P0002`). El estado HTTP se corrigió solo para esta función (ver «MSF-638: `obtener_reparacion` fuera del alcance»); el resto sigue pendiente.

## Pendiente (y por qué)

- **Estado HTTP 4xx en el servidor** para `P0002`/`55000`/`55006`/`40001` en las funciones de `public`. Propuesta:
  1) verificar con un JWT real contra el PostgREST instalado que `raise ... using errcode = 'PT404'` / `'PT409'` se
  traducen a 404/409 (`message`/`detail`/`hint` se conservan); 2) crear un helper `private.error_negocio(tipo,
  mensaje, hint)` y migrar por olas, empezando por las críticas (`obtener_reparacion`, `aceptar_presupuesto`,
  `anular_comprobante`, `confirmar_comprobante`, `cambiar_estado_despacho`, `actualizar_producto`), cada ola con su
  pgTAP; 3) actualizar a la vez los mapeos del cliente para aceptar el código viejo y el nuevo.
- Alcance por código, **contado por migraciones, sin verificar contra `pg_proc`** (última definición de cada función
  de `public`): `P0002` 163 funciones (más 22 en `private` y 2 en `publico`), `55000` 39, `40001` 38, `54000` 13,
  `55006` 3. Consulta para verificarlo en una base:
  `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~* 'errcode\s*=\s*''55000''';`
- `publico.registrar_interes_whatsapp` y `publico.crear_consulta_publica` lanzan `P0002` ante un host desconocido y
  los llama `anon`: se resuelven con la misma convención, cuidando de no revelar qué hosts existen.

## MSF-600: anular una factura con cobros parciales

**Resuelto en el lote 32.** Con la decisión de negocio tomada (MSF-667: contra-asiento auditado), `anular_comprobante` rechaza
una factura con cobros registrados (error de negocio, «revertí el cobro o corregila con una nota de crédito») y la persona sale con
`revertir_cobro` (solo administrador activo o superadmin con organización activa: `private.puede_escribir()`). También rechaza la factura ya entregada (MSF-661). Detalle en
`docs/cobros-por-comprobante.md`.

## MSF-638: `obtener_reparacion` fuera del alcance

**Primera ola de la convención `PT404`** (lote 32): `obtener_reparacion` responde `PT404` (HTTP 404) con el mismo mensaje cuando la
reparación no existe, es de otra organización o de una tienda inaccesible (sin oráculo de existencia), y `42501` (403) sin la
sección `service_tecnico`. El cliente acepta `P0002` y `PT404`. Sigue pendiente la verificación con un JWT real contra el
PostgREST instalado y el resto de las olas (propuesta de arriba).

## Segunda ola: `aceptar_presupuesto` (MSF-599)

`aceptar_presupuesto` responde `PT409` (HTTP 409) cuando el presupuesto está vencido o ya no se puede aceptar y `PT404`
(HTTP 404) cuando no existe o es de otra organización (mismo código y mensaje: sin oráculo). Se eligió esta función porque
es el caso del hallazgo y tiene una sola definición vigente, así que el cambio es un `create or replace` aditivo sin tocar
grants. Regla: el cliente tiene que aceptar el código viejo **y** el nuevo (`mensajeDeErrorBase`, `mensajeDeErrorComprobante`
y `mensajeDeAceptarPresupuesto` los tratan igual), porque la migración y el despliegue de la web no son simultáneos. Las demás
funciones se migraron en olas posteriores (ver la tabla de abajo); los respaldos (`55006`) los consume Kestra por
código y no una pantalla, así que no se tocan. Cada ola nueva repite el patrón: migración con la definición vigente, pgTAP que
afirma código y mensaje, y el mapeo del cliente en el mismo cambio.

## Tercera ola: comprobantes de venta (MSF-654 y MSF-655, parciales)

La familia elegida es la de comprobantes de venta, porque es donde la persona ve el error y donde ya había un único camino de
mensajes en el cliente: `guardar_comprobante`, `guardar_lineas_comprobante`, `confirmar_comprobante`, `anular_comprobante`,
`cambiar_estado_comprobante`, `obtener_comprobante`, `historial_comprobante`, `transiciones_permitidas_comprobante`,
`saldo_comprobante` y `cobros_de_comprobante`. Cada una se redefine con `create or replace` a partir de su definición vigente y
cambia solo el código; mensajes, grants y `security definer` quedan igual.

Convención ampliada:

- **«No existe»** usa `PT404` (HTTP 404), como `obtener_reparacion` y `aceptar_presupuesto`.
- **Conflicto de edición** (bloqueo optimista por `updated_at`) usa `PT412` (HTTP 412). Se eligió un código propio y no `PT409` porque
  el cliente trata `PT409` como «el estado no admite la acción» (con otro texto: «recargá para ver cómo está») y mezclar los dos
  mostraría un mensaje equivocado ante un conflicto de edición.
- **El cliente acepta el código viejo y el nuevo** (`esCodigoDeConflicto` y el mapeo de cada módulo), porque migración y despliegue
  de la web no son simultáneos. Cuando todas las pantallas lean solo el código nuevo se puede retirar el viejo.

## Cuarta ola: despacho, envíos y cobros (MSF-654 y MSF-655, parciales)

Misma regla (`P0002` a `PT404`, `40001` a `PT412`, mensaje intacto) para `cambiar_estado_despacho`, `registrar_faltantes_despacho`,
`guardar_envio_comprobante`, `obtener_despacho_comprobante`, `obtener_envio_comprobante`, `listar_responsables_despacho`,
`registrar_cobro`, `revertir_cobro`, `actualizar_forma_pago`, `actualizar_cuenta_cobro`, `cambiar_estado_forma_pago` y
`cambiar_estado_cuenta_cobro`. Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function; el cliente
acepta los dos códigos. Antes de copiar un cuerpo hay que comprobar que ningún barrido posterior lo reescribió en la base
(`20270418000401` cambió `public.clientes` por `dominio.clientes`): ya falló una vez en CI por eso.

## Quinta ola: formas de envío, transportes, contrarreembolsos y envíos en moto (MSF-654 y MSF-655, parciales)

Misma regla para `actualizar_forma_envio`, `cambiar_estado_forma_envio`, `actualizar_transporte`, `cambiar_estado_transporte`,
`marcar_contrarreembolso_cobrado` y `actualizar_envio_moto` (esta última solo tenía el conflicto de edición). Ninguna es llamable por
`anon` ni la consume Kestra, un worker o una Edge Function. `conciliar_pago` y `revertir_conciliacion_pago` quedan afuera: son
envoltorios que delegan en funciones de `private`, donde se lanzan los errores. `cambiar_estado_forma_envio` y `cambiar_estado_transporte` solo emiten `PT404`: no
usan bloqueo optimista.

## Sexta ola: productos, categorías, proveedores y promociones de precio (MSF-654 y MSF-655, parciales)

Misma regla (`P0002` a `PT404`, `40001` a `PT412`, mensaje intacto) para `actualizar_producto`, `cambiar_estado_producto`,
`definir_empresas_producto`, `asignar_categoria_producto`, `guardar_relacionados`, `guardar_categoria`, `eliminar_categoria`,
`reordenar_categorias`, `actualizar_proveedor`, `cambiar_estado_proveedor`, `guardar_promocion_precio` y `anular_promocion_precio`.
Ninguna es llamable por `anon` ni la consume Kestra, un worker o una Edge Function (el script de datos de demostración llama a tres,
sin leer el código de error). Quedan afuera `guardar_variantes_producto` (su rechazo por stock usa `40001` con `detail = 'stock'`,
un contrato propio) y las operaciones masivas (`mover_productos_categoria`, `cambiar_estado_productos`,
`definir_empresas_productos`), que validan los ids con un auxiliar de `private` y siguen con `P0002`. Los códigos que emite cada
función están en la tabla de abajo; el cliente acepta los dos (`esCodigoDeConflicto` y el mapeo de cada módulo).

## Séptima ola: alícuotas, escalas y precios propios, y empresas y contactos de proveedores (MSF-654 y MSF-655, parciales)

Misma regla (`P0002` a `PT404`, `40001` a `PT412`, mensaje intacto) para `guardar_regla_precio_empresa`, `previsualizar_precios_empresa`,
`guardar_precios_escala`, `asignar_alicuota_producto`, `guardar_alicuota_categoria`, `fijar_precio_propio`, `quitar_precio_propio`,
`guardar_empresas_de_proveedor`, `agregar_contacto_proveedor` y `marcar_contacto_principal`. Ninguna es llamable por `anon` ni la consume
Kestra, un worker o una Edge Function (el script de datos de demostración llama a cuatro, sin leer el código de error) y los auxiliares de
`private` que usan no lanzan `P0002` ni `40001`. Solo `guardar_regla_precio_empresa` tiene bloqueo optimista; las demás solo emiten `PT404`.
El cliente acepta los dos códigos (`esCodigoDeConflicto` y el mapeo de cada módulo).

## Octava ola: Service técnico, catálogos, historial y consultas (MSF-654 y MSF-655, parciales)

Misma regla (`P0002` a `PT404`, `40001` a `PT412`, mensaje intacto) para `actualizar_modelo_equipo`, `cambiar_estado_modelo_equipo`,
`actualizar_estado_reparacion`, `cambiar_estado_estado_reparacion`, `mover_estado_reparacion`, `historial_reparacion`,
`listar_adjuntos_reparacion`, `comprobante_de_reparacion` y `obtener_vinculos_garantia`. Ninguna es llamable por `anon` ni la consume
Kestra, un worker o una Edge Function (el script de datos de demostración llama a cuatro, sin leer el código de error). Solo
`actualizar_modelo_equipo` y `actualizar_estado_reparacion` tienen bloqueo optimista; las demás solo emiten `PT404`. Quedan afuera
`agregar_item_reparacion`, `quitar_item_reparacion`, `registrar_adjunto_reparacion` y `quitar_adjunto_reparacion` (validan con auxiliares de
`private` que siguen con `P0002` y `55000`), `actualizar_reparacion`, `cambiar_estado_reparacion`, `registrar_entrega_reparacion`,
`anular_reparacion`, `generar_comprobante_reparacion` y `reingresar_por_garantia` (emiten también `55000`) y las del flujo de avisos al
cliente (`avisar_cliente_reparacion`, `avisos_de_reparacion`, `obtener_enlace_consulta`). El cliente acepta los dos códigos
(`esCodigoDeConflicto` y el mapeo de cada módulo de Service).

Funciones migradas por ola (las olas 1 a 8 usan `PT404` para «no existe» y `PT412` para conflicto de edición; las que no tienen
bloqueo optimista solo emiten `PT404`; la ola 9 solo convierte `55000` a `PT409`):

| Ola | Migración | Funciones |
|---|---|---|
| 1 | `20270507180500` | `obtener_reparacion` |
| 2 | `20270507310000` | `aceptar_presupuesto` (con `PT409` para el estado que no admite aceptar) |
| 3 | `20270507340000` | `guardar_comprobante`, `guardar_lineas_comprobante`, `confirmar_comprobante` (solo `PT404`), `anular_comprobante`, `cambiar_estado_comprobante`, `obtener_comprobante`, `historial_comprobante`, `transiciones_permitidas_comprobante`, `saldo_comprobante`, `cobros_de_comprobante` |
| 4 | `20270507350000` | `cambiar_estado_despacho`, `registrar_faltantes_despacho`, `guardar_envio_comprobante`, `obtener_despacho_comprobante`, `obtener_envio_comprobante`, `listar_responsables_despacho`, `registrar_cobro`, `revertir_cobro`, `actualizar_forma_pago`, `actualizar_cuenta_cobro`, `cambiar_estado_forma_pago`, `cambiar_estado_cuenta_cobro` |
| 5 | `20270507360000` | `actualizar_forma_envio`, `cambiar_estado_forma_envio`, `actualizar_transporte`, `cambiar_estado_transporte`, `marcar_contrarreembolso_cobrado`, `actualizar_envio_moto` (solo conflicto) |
| 6 | `20270507410000` | `actualizar_producto`, `cambiar_estado_producto` (solo `PT404`), `definir_empresas_producto` (solo `PT404`), `asignar_categoria_producto` (solo `PT404`), `guardar_relacionados` (solo `PT404`), `guardar_categoria` (solo `PT404`), `eliminar_categoria` (solo `PT404`), `reordenar_categorias` (solo `PT404`), `actualizar_proveedor`, `cambiar_estado_proveedor` (solo `PT404`), `guardar_promocion_precio`, `anular_promocion_precio` |
| 7 | `20270507420000` | `guardar_regla_precio_empresa` (`PT404` y `PT412`), `previsualizar_precios_empresa` (solo `PT404`), `guardar_precios_escala` (solo `PT404`), `asignar_alicuota_producto` (solo `PT404`), `guardar_alicuota_categoria` (solo `PT404`), `fijar_precio_propio` (solo `PT404`), `quitar_precio_propio` (solo `PT404`), `guardar_empresas_de_proveedor` (solo `PT404`), `agregar_contacto_proveedor` (solo `PT404`), `marcar_contacto_principal` (solo `PT404`) |
| 8 | `20270507430000` | `actualizar_modelo_equipo` (`PT404` y `PT412`), `cambiar_estado_modelo_equipo` (solo `PT404`), `actualizar_estado_reparacion` (`PT404` y `PT412`), `cambiar_estado_estado_reparacion` (solo `PT404`), `mover_estado_reparacion` (solo `PT404`), `historial_reparacion` (solo `PT404`), `listar_adjuntos_reparacion` (solo `PT404`), `comprobante_de_reparacion` (solo `PT404`), `obtener_vinculos_garantia` (solo `PT404`) |
| 9 | `20270507440000` | `PT409` (antes `55000`): `confirmar_comprobante`, `anular_comprobante`, `cambiar_estado_comprobante`, `guardar_comprobante`, `guardar_lineas_comprobante`, `cambiar_estado_despacho`, `registrar_faltantes_despacho`, `guardar_envio_comprobante`, `registrar_cobro`, `revertir_cobro`, `marcar_contrarreembolso_cobrado`, `actualizar_envio_moto` (29 rechazos: 1 + 5 + 2 + 1 + 1 + 3 + 3 + 3 + 2 + 5 + 1 + 2, en el orden de la lista) |

**Cómo revertir una ola:** volver a aplicar, en una migración nueva, la definición vigente anterior de cada función (la última migración previa que la redefine; los códigos `PT404`/`PT412`/`PT409` solo cambian el `errcode`) y restaurar los `comment on function` previos (los de la última migración anterior que los fijó, no los de la migración de la ola). Las migraciones ya aplicadas no se editan.

La documentación técnica de producto y API no enumera qué función emite cada código: remite a esta página.

Queda para próximas olas (los tickets siguen abiertos): el resto de las funciones con `P0002` y `40001` (el resto de Service con `55000` o auxiliares de `private`, y del flujo de avisos y consulta pública `regenerar_enlace_consulta`, `avisos_de_reparacion` y `obtener_enlace_consulta`, que siguen con `P0002`; contactos de clientes y consultas, gastos,
listas de precios, newsletter, RMA, variantes y operaciones masivas de productos, conciliación de pagos, etc.), los `55000` de las demás funciones (Service, RMA, newsletter, `rendir_envios_moto`, `emitir_nota_credito`, `facturar_presupuesto`, auxiliares de `private`; los de bandera apagada se quedan), el `40001` con hint `precios_cambiaron` de
`confirmar_comprobante` y `facturar_presupuesto` (contrato propio por hint y detail), los topes `54000`
(`aplicar_lote_clientes`, `exportar_clientes`), los respaldos `55006` (los consume Kestra por código) y las funciones del esquema
`publico` llamables por `anon`. Sigue sin verificarse contra un PostgREST real con JWT que `PT412` se traduzca a 412.

## Novena ola: estado o regla de negocio que impide la acción, `55000` a `PT409` (MSF-599)

Convierte en bloque los `55000` de estado de negocio de funciones ya migradas en las olas 3, 4 y 5 (comprobantes, despacho, cobros, contrarreembolsos
y envíos en moto). Solo cambia el errcode de los rechazos «el estado o la regla de negocio no admite la acción» (factura cerrada,
borrador, anulada, ya entregada, con cobros, cobro ya revertido o conciliado, transición de despacho inválida, envío rendido…) a
`PT409` (HTTP 409); mensaje, firma, `security definer` y grants no cambian. Funciones: ver la fila 9 de la tabla (29 rechazos). Ninguna es
llamable por `anon` ni la consume Kestra, un worker o una Edge Function.

Se dejaron con `55000` a propósito:

- **Bandera apagada («desactivada en este entorno»)**: `guardar_promocion_precio`, listas de precios, newsletter, opiniones y precios
  masivos. Es una falla de configuración del entorno y no una regla de negocio de la persona, así que un 5xx es legítimo.
- **Contrato propio por `detail`**: la verificación de dominio de la tienda (`demasiado_pronto`, `verificacion_obsoleta`).
- **Lanzados por un auxiliar de `private`**: `private.registrar_cobro_interno` (lo usan `registrar_cobro` y
  `marcar_contrarreembolso_cobrado`: ante un rechazo de ese auxiliar, «La factura no está en un estado operativo: no admite cobros», borrador o anulada, sigue llegando `55000`),
  `private.marcar_estado_cobro_comprobante`, `private.abrir_contrarreembolso` y `private.aplicar_conciliacion`.
- **Funciones no migradas todavía**: `rendir_envios_moto`, `emitir_nota_credito`, `facturar_presupuesto`, Service, RMA, newsletter.

Efecto en el cliente: `lib/mensajeErrorBase.ts` exporta `esCodigoDeEstado` (`55000` o `PT409`) y lo usan los mapeos de comprobantes,
confirmación, anulación, estados, despacho, envío, faltantes, cobros, envíos en moto y contrarreembolsos; muestran lo mismo con los dos
códigos (test `lib/ventasErrorDeEstado.test.ts`). Ningún consumidor reintenta ni alerta por 5xx para estos errores: el cambio es solo que
el servidor deja de contarlos como falla.

## MSF-721: «Nueva devolución» no encontraba la factura

El diálogo pedía la página 1 (20 filas) de `listar_comprobantes` y filtraba en el cliente las facturas no
borrador ni anuladas. Ahora `listarFacturasElegibles` (`lib/facturasElegibles.ts`) filtra cada página y sigue con
la siguiente hasta juntar 20 elegibles (tope: 10 páginas de 50), corta si la persona cierra el diálogo o sigue
tipeando, avisa «Hay más resultados: refiná la búsqueda» si se agota el tope con páginas pendientes y, si una página
falla, muestra «No pudimos cargar los comprobantes.» con «Reintentar». Sin cambios en la base.

Hecho: el filtro Estado de Comprobantes ofrece **Borrador** y **Anulada**, tanto en la pantalla como en el prototipo
(`VentasComprobantes.dc.html`) y su inventario. Pendiente: mostrar el estado de despacho en el listado, que cambia lo
visible y exige actualizar primero el prototipo.
