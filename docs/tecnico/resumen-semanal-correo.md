---
owner: tecnico
sources:
  - specs/20261114-100000-analitica-avanzada-y-resumen-por-correo
  - supabase/migrations
  - apps/web/src
---

# Resumen semanal por correo (F-REP-08)

Épica MSF-265 · historia F-REP-08. Spec: `specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/` (RF-REP-08-1…9, SC-002, SC-003). Contrato: `contracts/resumen-semanal.md` de esa spec. Manual para quien usa el panel: [Tableros analíticos y resumen semanal](../producto/tableros-analiticos.md).

> **Estado:** la épica está implementada en la rama `epic/MSF-265-analitica-y-resumen-por-correo` (migraciones `20270324100200`–`20270324100300`, Edge Function `enviar-resumen-semanal`, flow `resumen-semanal`, sección en Mi organización y tests), **todavía no mergeada a `main`**: los scripts `test:edge:enviar-resumen-semanal` y `test:kestra:resumen-semanal` existen en esa rama, no en `main`. La guía de abajo se corre en la rama de la épica. TODO (dueño: quien mergee la épica): confirmar el merge y quitar esta nota.

Cada **lunes a las 08:00 (hora de Buenos Aires)** los administradores de cada organización reciben **un correo** con la
semana que terminó: ventas, margen, stock en alerta y faltantes pendientes. Cada organización puede **pausarlo** y
cada persona puede **darse de baja**.

## Cómo funciona

1. **Kestra** (`infra/kestra/flows/resumen-semanal.yml`): dos disparadores en la zona `America/Argentina/Buenos_Aires`
   —`lunes_0800` (`0 8 * * 1`) y `reintentos` (`*/15 * * * *`)— que hacen `POST {"barrer": true}` a la Edge Function con
   el secreto compartido. Es solo el «disparo»: el repo no dispara HTTP desde SQL (`docs/adoptar-ciclo-ejecuciones.md`
   §3.1).
2. **Edge Function** `enviar-resumen-semanal` (patrón de `enviar-resumen-reposicion`): para cada organización pendiente
   llama a `generar_resumen_semanal`, arma el texto en castellano y lo envía por el SMTP del proyecto (`SMTP_*`), y
   cierra el resumen con `cerrar_resumen_semanal`.
3. **Base** (`supabase/migrations/20270324100200_resumen_semanal.sql`): calcula y registra.
   `public.resumen_semanal_envios` guarda un resumen **por organización y semana** (`unique`), con el contenido
   congelado, el estado, los intentos y el error.

### Ventana y semana cubierta

La generación solo ocurre **de lunes 08:00 a martes** (hora de Buenos Aires) y cubre la semana lunes a domingo
anterior. Si Kestra estuvo caído el lunes, el barrido del martes todavía lo genera; pasado el martes no se genera uno
atrasado. Los pendientes y fallidos se reintentan a cualquier hora, hasta 5 intentos (`MAX_INTENTOS`).

### Estados

`pendiente` (reservado 2 minutos para que dos barridos no manden lo mismo) → `enviado` o `fallido` (se reintenta con
el **mismo contenido**) · `sin_destinatario` (no había administradores con correo; se reevalúa dentro de la ventana) ·
`pausado` (la organización lo pausó antes de que saliera) · `vencido` (quedó sin enviar de una semana anterior: se
cierra en el próximo barrido de la organización y nunca se manda atrasado).

Una pausa **no toca** un resumen en vuelo (reservado hace menos de 2 minutos). Si la pausa lo alcanza con la reserva
vencida y el correo salió igual, `cerrar_resumen_semanal(…, true)` lo registra como `enviado` (queda constancia); un
cierre con fallo no pisa un `pausado`.

Garantía de entrega: **al menos una vez**. Si el correo salió pero la base no pudo cerrar el resumen, el reintento lo
reenvía (se prefiere un duplicado a perder el resumen) y queda en los registros de la función.

## Destinatarios

Miembros **activos** con rol `administrador`, con correo y con la preferencia `resumen_semanal` encendida (sin fila =
encendida). Un solo correo con todos los destinatarios en «Para»: **todos los administradores de la misma organización
van juntos en un único mensaje y cada uno ve las direcciones de los demás** (no hay un correo por persona). No se
excluye a usuarios baneados ni con el correo sin confirmar: es el mismo criterio que el resumen de reposición, y alcanza
con ser administrador activo con correo. La función **nunca** toma destinatarios del pedido, rechaza con `403` (no
`401`) un pedido sin el token y con `413` un cuerpo de más de 64 KB (`MAX_CUERPO_BYTES`); sin configuración responde
`503` y si algún envío falla el barrido responde `502` para que Kestra marque la ejecución.

## Contenido

| Sección | Fuente | Cuándo aparece |
|---|---|---|
| Ventas | `analitica.ventas_periodo_canal` (MSF-192) | Si la vista existe: facturado con IVA, contra la semana anterior, comprobantes, unidades y las 5 tiendas que más facturaron; sin ventas dice «No hubo ventas en la semana» |
| Margen y rentabilidad | `analitica.rentabilidad_ventas_real` y `analitica.margen_producto_canal` (MSF-120) | Si la vista existe: vendido, margen y margen % de lo vendido, y cuántos productos están hoy con margen bajo o negativo |
| Stock en alerta | `public.stock_estados` (MSF-231/140) | Si existe y hay productos activos sin stock o bajo el mínimo: cuántos son y hasta 5 con nombre, código y estado |
| Faltantes pendientes | `dominio.faltantes_venta` (MSF-161) | Si existe y hay faltantes abiertos (cantidad, unidades y días del más antiguo, contados con la fecha de Buenos Aires) |

Las secciones cuya fuente no existe se omiten sin error (`to_regclass` las consulta antes de leer). Solo hay
**agregados** de la organización: ni clientes, ni comprobantes individuales, ni correos. El correo es texto plano en
castellano de Argentina, con enlaces al panel, a los tableros, a la pausa (Mi organización) y a la baja personal (Avisos
por correo).

## Pausa y baja

- **Pausa por organización**: «Mi organización» → «Resumen semanal por correo» (interruptor). Solo administradores
  (`configurar_resumen_semanal` exige `private.puede_escribir()`); un cambio real deja el evento `resumen_semanal.pausado`
  o `resumen_semanal.reanudado` en [Actividad](../actividad.md).
- **Baja personal**: «Avisos por correo» (`/cuenta/avisos`) lista «Resumen semanal de la organización» para quien tiene
  la sección `usuarios_permisos` (por defecto, el administrador).

## Secretos y variables (solo por entorno)

| Dónde | Variable | Nota |
|---|---|---|
| Función (`supabase secrets set`) | `RESUMEN_SEMANAL_TOKEN` | Secreto compartido con Kestra (cabecera `x-aviso-token`); sin él la función rechaza todo |
| Función | `PANEL_URL`, `SMTP_*` | Los mismos de los demás correos |
| `supabase/config.toml` (`[edge_runtime.secrets]`) | `RESUMEN_SEMANAL_TOKEN = "env(…)"` | Para el runtime de dev |
| Kestra (`infra/kestra/.env`) | `RESUMEN_SEMANAL_URL`, `RESUMEN_SEMANAL_APIKEY`, `SECRET_RESUMEN_SEMANAL_TOKEN` | El token va **en base64** (`printf '%s' '<token>' \| base64 -w0`); decodificado debe igualar al de la función |

Ningún valor real está en Git (solo `.env.example`).

## Operación

- Registro de una semana: `select estado, intentos, ultimo_error from public.resumen_semanal_envios where semana_desde = '<lunes>' order by organizacion_id;` (como superusuario).
- Un resumen `fallido` conserva un motivo fijo y sin datos de conexión; el detalle del SMTP está en los registros de la función.
- Reenviar a mano una organización: `POST {"organizacion_id": "<uuid>"}` a la función con el token (solo dentro de la ventana y si no está `enviado`).
- Despliegue: migraciones `20270324*` → secretos de la función → Edge Function `enviar-resumen-semanal` → variables y flow `resumen-semanal` de Kestra. Una función nueva con la base sin migrar falla en el barrido (502) sin enviar nada.

## Lo que NO se validó contra sistemas reales (MSF-949)

Se probó con pgTAP, handlers con mocks y el contrato estático del flow, pero **no** en un Kestra real (el cron con
`timezone` y el secreto en base64), **ni con un SMTP real**, ni el recorrido de punta a punta. Además, **la Edge
Function `enviar-resumen-semanal` no queda registrada en el runtime de dev hasta recrear el stack** (una función nueva
responde «Function not found»; reiniciar solo el runtime no alcanza). Seguimiento: **MSF-949**.

## Cómo probarlo (guía técnica)

Cada paso lleva el rótulo de su tarea para que el Reportero lo pueda automatizar con Playwright. En `main` todavía no
existen los scripts de la épica; corré esta guía en la rama `epic/MSF-265-analitica-y-resumen-por-correo`.

### Prerrequisitos

- `pnpm dev:supabase` (en la rama de la épica ya aplica las migraciones; si no, `supabase migration up --local`) con las
  migraciones `20270324100200` y `20270324100300` aplicadas.
- Una organización con dos administradores activos con correo, ventas de la semana anterior, stock en alerta y al
  menos un faltante abierto. Una persona operadora para el caso sin permiso.
- El panel: `pnpm dev:refine` (Docker) o `pnpm dev:refine:host`. Para el correo real, `RESUMEN_SEMANAL_TOKEN` y
  `SMTP_*` configurados; en dev alcanza con los mocks de los tests.

### Pasos

1. `[MSF-265:T007]` Corré el pgTAP `supabase/tests/database/resumen_semanal.test.sql`
   (`supabase test db --local supabase/tests/database/resumen_semanal.test.sql`; `pnpm test:db` corre toda la suite).
   Comprobá: tablas en `public` con RLS y sin políticas, `unique (organizacion_id, semana_desde)`, la ventana lunes 08:00
   a martes, los estados y la reserva de 2 minutos, y que `anon`/`authenticated` no ejecuten las RPC de `service_role`.
2. `[MSF-265:T008]` Generá un resumen para una organización de prueba dentro de `begin … rollback` y leé el `contenido`:
   las cuatro secciones, los agregados, las secciones omitidas cuando falta la fuente y **ningún** nombre de cliente,
   correo ni comprobante individual. Verificá que el contenido de una organización no aparezca en el de otra.
3. `[MSF-265:T009]` Corré `pnpm test:edge:enviar-resumen-semanal`. Después, con la función levantada, hacé un `POST` sin
   token (debe dar `403`), con un cuerpo de más de 64 KB (`413`) y con dos organizaciones pendientes (un solo correo
   por organización). Simulá un fallo de SMTP: el resumen queda `fallido` con un motivo fijo y el barrido responde `502`
   sin duplicar.
4. `[MSF-265:T010]` Corré `pnpm test:kestra:resumen-semanal` y `pnpm infra:config`. Revisá el flow: `lunes_0800` con
   `timezone: America/Argentina/Buenos_Aires`, `reintentos` cada 15 minutos y `{{ secret('RESUMEN_SEMANAL_TOKEN') }}`
   sin valores escritos en el YAML. Decodificá el secreto de Kestra y comprobá que iguale al de la función.
5. `[MSF-265:T011]` Revisá `handler.test.ts`: las cuatro secciones y sus enlaces, el texto sin saltos de línea ni
   cabeceras inyectadas, el tope de ítems, el reintento con el mismo contenido y que los destinatarios nunca salgan del
   pedido.
6. `[MSF-265:T012]` Entrá como administradora a **Administración → Mi organización**, sección **Resumen semanal por
   correo**: pausá, comprobá que el próximo envío y el último resumen se muestren, y volvé a activar. Mirá el evento en
   **Actividad**. Entrá a **Avisos por correo** (`/cuenta/avisos`) y apagá «Resumen semanal de la organización».
   Repetí la pausa con una operadora: no debe ver el interruptor ni poder ejecutar la RPC.

### Resultado esperado

- Un resumen por organización y semana, con el contenido congelado y los estados correctos; los reintentos no duplican y
  respetan el tope de 5 intentos.
- La pausa y la baja personal se guardan; solo un administrador puede pausar y cada cambio real deja un evento en
  Actividad.
- La función responde `403` sin token y `413` con un cuerpo mayor a 64 KB; un fallo de SMTP queda registrado sin exponer
  datos de conexión.
- El flow usa la zona horaria de Buenos Aires y el secreto en base64, sin valores en Git.
- En dev no se envía un correo real sin SMTP configurado: eso queda para la verificación de MSF-949.

### Cómo automatizarlo

- Base: pgTAP `supabase/tests/database/resumen_semanal.test.sql` (ventana, idempotencia, contenido, aislamiento, pausa y
  privilegios).
- Función: `pnpm test:edge:enviar-resumen-semanal` (incluye `handler.test.ts`).
- Flow: `pnpm test:kestra:resumen-semanal` (contrato estático) y `pnpm infra:config`.
- Pantalla: Vitest `apps/web/src/pages/organizacion/ResumenSemanal.test.tsx` y `edit.test.tsx`.
- **E2E pendiente:** no hay specs Playwright con el rótulo `[MSF-265:T012]`. Cuando se escriban, el paso 6 es el
  recorrido a automatizar; el resto ya está cubierto por los tests nombrados.

## Capturas pendientes

- TODO (dueño: Documentador, tras el merge de la épica): generar las capturas del manual con `pnpm docs:capturas` para
  la sección «Resumen semanal por correo» de Mi organización (con el interruptor activo y pausado) y para la pantalla
  «Avisos por correo» con el tipo «Resumen semanal de la organización». La herramienta de capturas del manual
  (`pnpm docs:capturas`, `apps/web/e2e/capturas/` y `pnpm demo:dataset`) **no existe en este repo** y el código de la
  épica todavía no está en `main`: hasta entonces las páginas de producto describen el comportamiento **sin imágenes
  nuevas**, no se inventó ninguna.

## Verificación automática

pgTAP `supabase/tests/database/resumen_semanal.test.sql`; `pnpm test:edge:enviar-resumen-semanal`;
`pnpm test:kestra:resumen-semanal`; Vitest `ResumenSemanal.test.tsx`. Revisión de seguridad: [revisión de seguridad de
la analítica avanzada](revision-seguridad-analitica-avanzada.md).

## Fuera de alcance

Lo que la spec deja explícitamente afuera:

- Un editor de contenido del correo, otro día u hora por organización, correo en HTML y envío a personas que no son
  administradores.
- Una pantalla de preferencia del resumen distinta de «Mi organización» y «Avisos por correo».
- Cuando la fuente de una sección no existe (por ejemplo, la vista de ventas), la sección **se omite**: no se inventa
  ningún total. El resto del out-of-scope de la épica está en
  [Analítica avanzada](analitica-avanzada.md#fuera-de-alcance).

## Reversión

Desactivar el flow `resumen-semanal` y la función; migración posterior que borre las RPC (`estado_resumen_semanal`,
`configurar_resumen_semanal`, `cerrar_resumen_semanal`, `generar_resumen_semanal`, `organizaciones_con_resumen_semanal_pendiente`
y las `private.*`), las dos tablas, la fila de `tipos_aviso` y las dos filas de `private.exclusiones_exportacion_total()`.
