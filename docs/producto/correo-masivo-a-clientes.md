---
owner: producto
sources:
  - specs
  - design/pantallas
  - apps/web/src
---

# Clientes · correo masivo a clientes (MSF-155)

**Épica:** MSF-155 — Clientes y proveedores · Correo masivo a clientes · **Historias:** F-CLI-11 «Destinatarios
del correo masivo» (MSF-357), F-CLI-12 «Redactar y enviar el correo masivo con baja» (MSF-370), F-CLI-13
«Historial de campañas de correo» (MSF-376). **Spec:** `specs/20261028-100000-correo-masivo-a-clientes/`. Detalle
técnico: [Correo masivo a clientes (técnico)](../tecnico/correo-masivo-a-clientes.md).

> **Estado:** el código de la épica (migraciones `20270120100000` y `20270121110000…110300`, páginas, flow y Edge
> Function) está en la rama `epic/MSF-155-clientes-y-proveedores-correo-masivo-a-c` con las tres historias y el
> cierre (T040–T043) marcados hechos; **no estaba en `main` al escribir esta página** (2026-10-31). La guía de
> abajo aplica una vez mergeada la épica. TODO (dueño: quien mergee la épica): confirmar el merge y quitar esta nota.

## Qué resuelve

Para el **equipo que administra Clientes** (roles con edición en la sección Clientes):

- **Armar un grupo de destinatarios por filtros** (búsqueda, tipo, empresa, «con cuenta web») o con los clientes
  marcados en el listado, y ver cuántos reciben el correo y cuántos quedan afuera y por qué.
- **Redactar y enviar** un correo (Asunto + Mensaje en texto plano) con vista previa y envío de prueba.
- **Baja automática:** cada correo trae al pie un enlace de baja; quien lo usa deja de recibir correo masivo.
- **Historial** de campañas con totales (enviados, fallidos, omitidos, bajas) y el detalle por destinatario.

## Reglas que conviene saber

- Solo reciben el correo los clientes **activos**, con **correo válido** (una sola dirección) y con el
  interruptor **«Incluir en el correo masivo»** encendido. Los clientes existentes quedan **sin aceptación** hasta
  que alguien los marque; en el alta el interruptor nace encendido. El Consumidor final nunca recibe.
- El envío es **en lotes con cupo diario por organización** (500 por defecto): lo que no entra el día de hoy sigue
  mañana, sin repetirse ni perderse. Por eso una campaña puede quedar «en curso» varias horas o días.
- Antes de salir, cada destinatario se **re-verifica**: si se archivó, dejó de aceptar o no tiene correo válido,
  queda «omitido».
- La baja se **confirma con un botón** en una página pública (`/baja-correo/:token`); abrir el enlace no da de baja.
- El correo sale por el proveedor de correo de los avisos (SMTP de Kestra); no hay proveedor nuevo.
- Con **empresa activa** distinta, el diálogo/confirmación abierto se cierra con aviso y la pantalla recarga
  (nunca se crea una campaña con datos de la empresa anterior).

## Fuera de alcance (no hecho en esta épica)

- Reenviar o editar una campaña ya creada; el historial es solo lectura.
- Newsletter con suscriptores por tienda (`Newsletter.dc.html`): no tiene historia en esta épica.
- Enviar la lista de «Clientes inactivos» (MSF-171) a una campaña: relación declarada, sin bloqueo; no se verificó
  en esta épica. TODO (dueño: MSF-171).
- Límite de frecuencia propio de la Edge Function de baja: queda para el borde (riesgo bajo aceptado en el cierre).
- Editor HTML: el mensaje es solo texto plano.

## Cómo probarlo

### Prerrequisitos

- Usuario con **edición en Clientes** (administrador) en el entorno DEV o local (`pnpm dev:supabase` + `pnpm dev:refine:host`).
  Un usuario con solo lectura puede ver el Historial pero no ve «Nueva campaña».
- Sembrar clientes: uno **con correo propio y aceptación**, uno **sin correo**, uno **con correo pero sin
  aceptación**, uno **archivado**. Usá un buzón al que tengas acceso para el primero.
- Para ver llegar el correo: flow `correo-masivo` de Kestra corriendo con las variables `KESTRA_SMTP_*`,
  `CORREO_MASIVO_URL_BAJA`, `CORREO_MASIVO_LOTE`, `CORREO_MASIVO_LIMITE_DIARIO` (ver
  [técnico](../tecnico/correo-masivo-a-clientes.md#flow-de-envio)). Sin Kestra, las campañas quedan «pendiente».

### Pasos

1. **Aceptación:** en `/clientes/show/:id` de un cliente, bloque **«Comunicaciones»**, encender/apagar
   «Incluir en el correo masivo». Se ve que guarda al instante; con solo lectura el control no es editable.
2. **Destinatarios:** menú Contactos → **«Correo masivo»** (`/clientes/correo-masivo`, «Nueva campaña»). Se ve la
   lista paginada de elegibles, el conteo y el resumen de quedan afuera «sin correo» y «no aceptan».
   El archivado y el Consumidor final no aparecen.
3. **Filtros:** escribir en «Buscar clientes», cambiar el filtro de tipo (Minorista/Mayorista) y el selector de
   empresa. La lista y el conteo se recargan y vuelven a la página 1.
4. **Desde el listado:** en `/clientes` marcar dos clientes y usar **«Enviar correo a seleccionados (N)»**. Sin
   marcar nada aparece «Elegí al menos un cliente con las casillas». Con marcados se abre el diálogo con
   «Se envía a los N clientes marcados…», Asunto, Mensaje, «Cancelar» y «Enviar correo».
5. **Redactar:** en «Nueva campaña», sección «Redactar el correo», completar Asunto y Mensaje. Vacíos o pasados de
   límite (200 / 10 000) bloquean el envío con mensaje de error.
6. **Vista previa y prueba:** abrir **Vista previa** (se ve el pie fijo con un enlace de baja de ejemplo que no se
   abre) y **Enviar prueba**: llega a tu correo con prefijo «[Prueba]» y no crea campaña.
7. **Enviar:** «Enviar correo» → confirmar. Se ve «Campaña creada» y el aviso ofrece **«Ver el historial»**. Un
   doble clic no crea dos campañas. Sin elegibles se rechaza.
8. **Recepción y baja:** abrir el correo recibido; el pie trae el enlace de baja. Abrirlo muestra «Darte de baja
   del correo masivo» y el botón **«Darme de baja»**; recién al apretarlo se confirma la baja. Repetirla muestra el
   mismo resultado.
9. **Historial:** `/clientes/correo-masivo/historial`. Se ve la campaña con fecha, asunto, autor, estado
   («N de M procesados» mientras esté en curso) y totales. Entrar al detalle (`…/historial/:id`): asunto, mensaje y
   cada destinatario con estado, marca de baja y error corto. La campaña recién creada muestra la baja del paso 8.
10. **Empresa activa:** con el diálogo o la confirmación de envío abiertos, cambiar la empresa en la barra
    superior: se cierra con el aviso «Cambiaste de empresa…» y no se crea campaña. En el Historial, la lista
    recarga solo con campañas de esa empresa y un detalle abierto vuelve al historial.

### Resultado esperado

- **Given** un cliente activo, con correo válido y «Incluir en el correo masivo» encendido, **When** un usuario con
  edición en Clientes crea una campaña, **Then** ese cliente recibe el correo con el enlace de baja y ve la campaña
  en el Historial con su estado y totales.
- **Given** un cliente que usó el enlace de baja, **When** se arma otra campaña, **Then** no aparece como
  destinatario (queda en «no aceptan») y los pendientes que tenía en campañas en curso pasan a «omitido».
- **Given** clientes sin correo, sin aceptación o archivados, **Then** nunca reciben el correo y el resumen
  dice cuántos quedaron afuera y por qué.
- **Given** un cambio de empresa activa, **Then** ninguna pantalla ni diálogo conserva datos de la empresa anterior.

### Cómo automatizarlo

**Todavía no existe un E2E (Playwright) de esta épica: queda pendiente de automatizar** (dueño: quien tome el
seguimiento de E2E de Clientes). Hoy la cobertura es de unidad/integración (ver técnico → Pruebas). Rótulos
propuestos, alineados a las tareas de `tasks.md`:

| Rótulo | Cubriría |
|---|---|
| `[MSF-155:T004]` | Pasos 2–3: destinatarios, filtros y resumen |
| `[MSF-155:T015]` | Pasos 5 y 7: redacción, confirmación y creación de campaña |
| `[MSF-155:T014]` | Paso 8: página pública de baja con confirmación |
| `[MSF-155:T022]` | Paso 9: historial y detalle |
| `[MSF-155:T006]` | Paso 10: cambio de empresa activa |
