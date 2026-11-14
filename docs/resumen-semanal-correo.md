---
owner: tecnico
sources:
  - specs/20261114-100000-analitica-avanzada-y-resumen-por-correo
  - supabase/migrations
  - apps/web/src
---

# Resumen semanal por correo (F-REP-08)

Épica MSF-265 · historia F-REP-08. Spec: `specs/20261114-100000-analitica-avanzada-y-resumen-por-correo/` (RF-REP-08-1…9, SC-002, SC-003). Contrato: `contracts/resumen-semanal.md` de esa spec.

Cada **lunes a las 08:00 (hora de Buenos Aires)** los administradores de cada organización reciben **un correo** con la semana que terminó: ventas, margen, stock en alerta y faltantes pendientes. Cada organización puede **pausarlo** y cada persona puede **darse de baja**.

## Cómo funciona

1. **Kestra** (`infra/kestra/flows/resumen-semanal.yml`): dos disparadores en la zona `America/Argentina/Buenos_Aires` —`lunes_0800` (`0 8 * * 1`) y `reintentos` (`*/15 * * * *`)— que hacen `POST {"barrer": true}` a la Edge Function con el secreto compartido. Es solo el «disparo»: el repo no dispara HTTP desde SQL (`docs/adoptar-ciclo-ejecuciones.md` §3.1).
2. **Edge Function** `enviar-resumen-semanal` (patrón de `enviar-resumen-reposicion`): para cada organización pendiente llama a `generar_resumen_semanal`, arma el texto en castellano y lo envía por el SMTP del proyecto (`SMTP_*`), y cierra el resumen con `cerrar_resumen_semanal`.
3. **Base** (`supabase/migrations/20270324100200_resumen_semanal.sql`): calcula y registra. `public.resumen_semanal_envios` guarda un resumen **por organización y semana** (`unique`), con el contenido congelado, el estado, los intentos y el error.

### Ventana y semana cubierta

La generación solo ocurre **de lunes 08:00 a martes** (hora de Buenos Aires) y cubre la semana lunes a domingo anterior. Si Kestra estuvo caído el lunes, el barrido del martes todavía lo genera; pasado el martes no se genera uno atrasado. Los pendientes y fallidos se reintentan a cualquier hora, hasta 5 intentos.

### Estados

`pendiente` (reservado 2 minutos para que dos barridos no manden lo mismo) → `enviado` o `fallido` (se reintenta con el **mismo contenido**) · `sin_destinatario` (no había administradores con correo; se reevalúa dentro de la ventana) · `pausado` (la organización lo pausó).

Garantía de entrega: **al menos una vez**. Si el correo salió pero la base no pudo cerrar el resumen, el reintento lo reenvía (se prefiere un duplicado a perder el resumen) y queda en los registros de la función.

## Destinatarios

Miembros **activos** con rol `administrador`, con correo y con la preferencia `resumen_semanal` encendida (sin fila = encendida). Un solo correo con todos los destinatarios en «Para». La función **nunca** toma destinatarios del pedido.

## Contenido

| Sección | Fuente | Cuándo aparece |
|---|---|---|
| Ventas | `analitica.ventas_periodo_canal` (MSF-192) | Si la vista existe: facturado con IVA, contra la semana anterior, comprobantes, unidades y las 5 tiendas que más facturaron; sin ventas dice «No hubo ventas en la semana» |
| Margen y rentabilidad | `analitica.rentabilidad_ventas_real` y `analitica.margen_producto_canal` (MSF-120) | Si la vista existe: margen real de lo vendido y productos con margen bajo o negativo hoy |
| Stock en alerta | `public.stock_estados` (MSF-231/140) | Si existe y hay productos activos sin stock o bajo el mínimo (hasta 5 nombres) |
| Faltantes pendientes | `dominio.faltantes_venta` (MSF-161) | Si existe y hay faltantes abiertos (cantidad, unidades y días del más antiguo) |

Las secciones cuya fuente no existe se omiten sin error. Solo hay **agregados** de la organización: ni clientes, ni comprobantes individuales, ni correos. El correo es texto plano en castellano de Argentina, con enlaces al panel, a los tableros, a la pausa (Mi organización) y a la baja personal (Avisos por correo).

## Pausa y baja

- **Pausa por organización**: «Mi organización» → «Resumen semanal por correo» (interruptor). Solo administradores (`configurar_resumen_semanal` exige `private.puede_escribir()`); un cambio real deja el evento `resumen_semanal.pausado` o `resumen_semanal.reanudado` en [Actividad](actividad.md).
- **Baja personal**: «Avisos por correo» (`/cuenta/avisos`) lista «Resumen semanal de la organización» para quien tiene la sección `usuarios_permisos` (por defecto, el administrador).

## Secretos y variables (solo por entorno)

| Dónde | Variable | Nota |
|---|---|---|
| Función (`supabase secrets set`) | `RESUMEN_SEMANAL_TOKEN` | Secreto compartido con Kestra (`x-aviso-token`); sin él la función rechaza todo |
| Función | `PANEL_URL`, `SMTP_*` | Los mismos de los demás correos |
| `supabase/config.toml` (`[edge_runtime.secrets]`) | `RESUMEN_SEMANAL_TOKEN = "env(…)"` | Para el runtime de dev |
| Kestra (`infra/kestra/.env`) | `RESUMEN_SEMANAL_URL`, `RESUMEN_SEMANAL_APIKEY`, `SECRET_RESUMEN_SEMANAL_TOKEN` | El token va **en base64** (`printf '%s' '<token>' | base64 -w0`); decodificado debe igualar al de la función |

Ningún valor real está en Git (solo `.env.example`).

## Operación

- Registro de una semana: `select estado, intentos, ultimo_error from public.resumen_semanal_envios where semana_desde = '<lunes>' order by organizacion_id;` (como superusuario).
- Un resumen `fallido` conserva un motivo fijo y sin datos de conexión; el detalle del SMTP está en los registros de la función.
- Reenviar a mano una organización: `POST {"organizacion_id": "<uuid>"}` a la función con el token (solo dentro de la ventana y si no está `enviado`).
- Despliegue: migraciones `20270324*` → secretos de la función → Edge Function `enviar-resumen-semanal` → variables y flow `resumen-semanal` de Kestra. Una función nueva con la base sin migrar falla en el barrido (502) sin enviar nada.

## Reversión

Desactivar el flow `resumen-semanal` y la función; migración posterior que borre las RPC (`estado_resumen_semanal`, `configurar_resumen_semanal`, `cerrar_resumen_semanal`, `generar_resumen_semanal`, `organizaciones_con_resumen_semanal_pendiente` y las `private.*`), las dos tablas, la fila de `tipos_aviso` y las dos filas de `private.exclusiones_exportacion_total()`.

## Verificación

pgTAP `supabase/tests/database/resumen_semanal.test.sql`; `pnpm test:edge:enviar-resumen-semanal`; `pnpm test:kestra:resumen-semanal`; Vitest `ResumenSemanal.test.tsx`. Revisión de seguridad: [revision-seguridad-analitica-avanzada.md](revision-seguridad-analitica-avanzada.md).
