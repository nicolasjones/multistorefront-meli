---
owner: producto
sources: []
---

# Decisiones de negocio del 2026-11-17

Resumen de las decisiones de negocio que se tomaron el 2026-11-17 (por delegación del dueño del producto) sobre
hallazgos de auditoría y errores que esperaban una definición antes de programarse. Cada una quedó registrada como
comentario «Decisión tomada» en su ticket.

> **Estado de las decisiones de esta página: decidida.** La mayoría sigue pendiente de implementar (las implementan
> otros lotes de trabajo); cada ítem dice en su línea si ya está aplicada. Esta página no afirma por sí sola que ya
> existan en el sistema. Mientras no se tome cada ticket en un lote, el comportamiento vigente sigue siendo el de
> hoy. Cada decisión se puede revertir si el dueño del producto no está de acuerdo.

## Dinero y comprobantes

### MSF-660 · Notas de crédito y saldo de la factura

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** el saldo de la factura pasa a ser `total − notas de crédito emitidas − cobros`, con mínimo 0. No se
  crea un estado nuevo: el estado sigue la regla actual por saldo (saldo 0 ⇒ cobrado). No se recalculan
  comprobantes viejos por migración de datos: solo cambia el cálculo. Va con spec y pgTAP en el lote de SQL de negocio.
- **Fundamento:** es un defecto de dinero; mantener los estados existentes evita tocar toda la interfaz.

### MSF-661 · Anular una factura ya entregada

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** se rechaza anular una factura con `estado_despacho = 'entregado'`, con el mensaje «corregí con nota de
  crédito o RMA».
- **Fundamento:** la mercadería ya salió; reingresarla al stock crea existencias fantasma. La corrección correcta es
  nota de crédito con devolución o RMA.

### MSF-667 · Reverso de cobro

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** se hará el reverso de cobro: un contra-asiento auditado, solo para administrador, con motivo
  obligatorio, que reabre `cobrado → deuda`.
- **Fundamento:** hoy un error de importe no tiene salida; un contra-asiento (no borrar) conserva la auditoría.

### MSF-720 · Redondeo del precio final, margen y cotización

- **Estado:** Decidida, **aplicada el 2026-11-24** (MSF-720): el precio final con IVA redondea al centavo en la
  base (`private.aplicar_iva`, migración `20270507180200_aplicar_iva_al_centavo.sql`), la cotización se muestra con
  hasta 4 decimales y el texto del margen aclara que no incluye la comisión del canal. No se recalculan los
  comprobantes ya emitidos.
- **Decisión:** criterio único: el precio final con IVA se redondea **al centavo**, igual que el total del
  comprobante. Se hace con una migración nueva de `private.aplicar_iva`, sin recalcular comprobantes ya emitidos. La
  cotización se muestra con hasta 4 decimales y el texto del margen aclara si incluye la comisión.
- **Fundamento:** el comprobante ya trabaja al centavo; igualar evita diferencias entre lo publicado y lo facturado.
  Lo emitido no se toca.

### MSF-668 · Facturar un presupuesto y retención de consultas

- **Estado:** Decidida, pendiente de implementar (dos historias aparte, cada una con su spec).
- **Decisión:** (a) «Facturar presupuesto» se hará: historia nueva con `origen_presupuesto_id`, vínculo y estado
  «Convertido». (b) Retención de consultas: 24 meses desde la última actividad; después se anonimizan nombre, contacto y
  mensaje (se conservan los agregados), con una purga mensual a cargo de un flujo de Kestra.
- **Precisiones (lote 39):** si la factura derivada se anula, el presupuesto **sigue convertido** (se convierte una sola
  vez) y, para volver a facturar, se **copia**. La retención mide `updated_at` de la consulta (24 meses desde su última
  actividad): se anonimiza lo que lo supera estrictamente.
- **Fundamento:** quitar la fricción de rehacer el presupuesto a mano y reducir el riesgo legal de acumular datos
  personales sin límite.

## Clientes y consultas

### MSF-596 · Identificador externo de un cliente

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** la unicidad del identificador externo de un cliente es por (organización, sistema externo,
  identificador externo), no global.
- **Fundamento:** dos organizaciones pueden usar el mismo identificador externo sin colisionar. Implica reescribir las
  funciones vigentes de vincular y de carga, por eso va en el lote de SQL de negocio con spec y pgTAP.

### MSF-666 · Aceptación de correo masivo en la migración de clientes

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** columna opcional `acepta_correo` en la importación de clientes, más una acción masiva «marcar
  aceptación» con registro de quién y cuándo. Sin valor por defecto: vacío = sin aceptación.
- **Fundamento:** el consentimiento no se presume; la migración no debe dejar la base con cero destinatarios sin forma
  de cargarlo.

### MSF-594 · Interfaz de la condición de IVA del cliente

- **Estado:** Decidida, pendiente de implementar (la vía de carga en base de datos ya fue corregida aparte; falta la
  interfaz).
- **Decisión:** selector con las condiciones habituales más «Otra» en la ficha del cliente y columna en el importador
  (propuesta ya recogida en la guía de clientes). Se actualiza primero el prototipo (`ClienteFicha`, `Clientes`) y
  después se implementa.
- **Fundamento:** el prototipo manda la interfaz: primero el prototipo, después el código.

### MSF-595 · Estados de consulta

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** los estados de consulta quedan **fijos** (tres). No se conecta `dominio.estados_consulta` con
  `consultas.estado`; se quita u oculta la configuración de estados y se documenta.
- **Fundamento:** pasar de un `check` a una clave foránea y sembrar estados por organización agrega complejidad sin
  demanda concreta.

### MSF-993 · Interés por WhatsApp

- **Estado:** Decidida, pendiente de implementar (lote de interfaz y SQL de consultas). Ya aplicado: que
  `registrar_interes_whatsapp` sea solo para `service_role` (migración
  `20270507150100_registrar_interes_whatsapp_solo_interna.sql:14-15`). Falta lo demás.
- **Decisión:** el diálogo «Interés por WhatsApp» y «Productos más consultados» leen las consultas de origen WhatsApp
  (la bandeja), sin tabla aparte, y se retira la tabla `intereses_whatsapp` (hasta entonces solo para el sembrado demo).
  Pendiente de implementar: leer las consultas de origen WhatsApp en la interfaz y retirar esa tabla.
- **Fundamento:** evita una segunda tabla alimentada por una RPC pública (más superficie de abuso) y reutiliza la cuota
  y el anti-spam de `registrar_consulta_whatsapp`.

## Pantallas y textos

### MSF-609 · Detalle de factura: acciones según el estado

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** no se cambia la base. Las acciones de documentos, envío, responsables y faltantes se deshabilitan en la
  interfaz hasta que el pedido esté `confirmada`, con un tooltip que lo explica.
- **Fundamento:** las RPC exigen `confirmada` a propósito; cambiar la base abre estados inconsistentes.

### MSF-615 · Reparación entregada

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** se ocultan «Anular» y «Guardar» en una reparación entregada (estado terminal).
- **Fundamento:** coherente con MSF-661: lo entregado no se anula, se corrige con nota de crédito o RMA.

### MSF-617 · Textos de plantilla en el ingreso

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** los textos de plantilla del ingreso («Un catálogo. Varias tiendas…», «+ futuras stores», «Panel
  interno») se reemplazan por un texto neutro de producto («Ingresá a tu panel»). Se actualiza `Login.dc.html` primero
  y luego la aplicación.
- **Fundamento:** el prototipo manda: se corrige en el prototipo y luego en el código.

### MSF-664 · Una sola pantalla de «Faltantes»

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** un solo modelo: `/stock/faltantes` (MSF-405) es la única pantalla. MSF-161, MSF-257 y MSF-270 se tratan
  como solapadas con F-STK-17 (se replantea o se cierra cada una al tomarla).
- **Fundamento:** dos pantallas con modelos distintos confunden y duplican mantenimiento; MSF-405 ya está construida.

## Permisos, validaciones y stock

### MSF-783 · Permisos de `/stock/motivos` y `/historial/importar`

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** opción 2: se corrige la matriz de permisos. `/stock/motivos` y `/historial/importar` quedan solo para
  administrador.
- **Fundamento:** mínimo privilegio; `/historial/importar` ya exige administrador en ruta, menú y servidor (PR #1130).
  Sin cambio de código de las operaciones. Si más adelante hace falta abrir `/stock/motivos` a otros roles, se decide
  con su propio permiso de escritura.

### MSF-651 · Escritura de documentos de la búsqueda documental

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** las políticas de escritura de `fragmentos_indexados` y del almacenamiento de documentos exigen
  `private.puede_escribir()` (el rol Consulta no escribe ni borra). pgTAP: el rol Consulta no puede insertar ni borrar.
- **Fundamento:** cierra el hueco con la regla de permisos ya existente, sin agregar una sección nueva a la matriz.

### MSF-701 · Validaciones de documento y chat de IA

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** DNI de 7 u 8 dígitos o CUIT con dígito verificador (reusando `validarCuit`). El chat de IA es visible
  para los roles con edición. El criterio de precios se decide en MSF-720.
- **Fundamento:** validación mínima que reutiliza código existente.

### MSF-719 · Toma de inventario

- **Estado:** Decidida, pendiente de implementar.
- **Decisión:** la toma de inventario muestra y permite elegir el depósito (por defecto el principal) y ofrece «Sin
  categoría» en el selector.
- **Fundamento:** hoy cuenta solo el depósito por defecto sin decirlo y deja afuera los productos sin categoría.

## Acceso, entornos y proceso

### MSF-681 · Vencimiento de la sesión

- **Estado:** Decidida, pendiente de implementar (la corrección de la guía de acceso y de ingreso).
- **Decisión:** se corrige la documentación: el vencimiento de 12 h es del cliente. No se activa `inactivity_timeout`
  en el servidor por ahora.
- **Fundamento:** activarlo cierra sesiones de usuarios de caja en pleno turno; se reevalúa si aparece un requisito de
  seguridad concreto.

### MSF-924 · STG un paso adelante de PRD

- **Estado:** Decidida, pendiente de implementar (la ejecución de la promoción es una acción aparte).
- **Decisión:** regla de despliegue: STG debe ir un paso adelante de PRD. Antes de promover a PRD se sincroniza STG con
  `dokploy` y se valida allí; no se promueve a PRD sin pasar por STG.
- **Fundamento:** una STG congelada junto con PRD no valida nada.

### MSF-685 · Cuándo corre `Validate`

- **Estado:** Decidida, pendiente de implementar (la corrección de la documentación ya se hizo en el PR #1123).
- **Decisión:** no se enciende `Validate` en cada push a `dokploy` (costo de runners). Se agrega una corrida diaria de
  `Validate` sobre `dokploy`; el control por PR sigue igual.
- **Fundamento:** mantiene el control sin multiplicar el costo por merge.

### MSF-755 · Regla de merge protegida

- **Estado:** Decidida; **corregida el 2026-11-20** (MSF-755), porque la premisa era falsa.
- **Decisión:** el merge sigue protegido por el flujo del repo —`merge-con-revisiones.sh` y `merge-seguro.sh` (dos
  revisiones sobre el SHA final más CI verde)— y el gate de `dokploy` es el **ruleset** `dokploy-integracion-protegida`
  (id `25358575`), activo, que exige el check `validacion` con «rama al día» desactivada
  (`strict_required_status_checks_policy: false`, desde el 2026-11-04).
- **Fundamento:** la decisión original («no se cambian las reglas de GitHub» porque «la protección de rama es de pago en
  repos privados») partía de una premisa que el repo mismo refuta: el gate existe y funciona como **ruleset**, sin
  depender de ese plan. Activar la «Merge queue» del ruleset **sí** cambiaría las reglas de GitHub, así que queda como
  decisión de Nicolás (ver «Pendientes del lote 36 que necesitan acción de Nicolás» en `docs/control-ci.md`); hasta
  entonces el estado es el de arriba.

## Acciones que siguen siendo de Nicolás

Estas acciones no las hace ningún lote de código; quedan a cargo de Nicolás:

- **SMTP real (MSF-532):** elegir el proveedor y cargar las credenciales.
- **`CORREO_MASIVO_URL_BAJA`:** cargarla en `VPS_DEPLOY_ENV` de staging y de production antes de promover.
- **Promoción DEV → STG → PRD:** ejecutarla. Recordá la regla de MSF-924: STG tiene que ir un paso adelante de PRD (se
  sincroniza con `dokploy` y se valida allí antes de promover a PRD).
- **Reglas de GitHub, runners y servidores:** los cambios de configuración fuera del repo (MSF-648, MSF-649, MSF-703,
  MSF-704, MSF-755 — la «Merge queue» del ruleset `dokploy-integracion-protegida`, con el procedimiento y el estado en
  «Pendientes del lote 36 que necesitan acción de Nicolás» de `docs/control-ci.md`).
