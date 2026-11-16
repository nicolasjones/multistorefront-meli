---
owner: tecnico
sources:
  - specs/20261016-130000-perfil-y-permisos-avanzados
  - scripts/verificar-salida-correo.mjs
  - supabase/functions/solicitar-acceso
---

# Verificación de salida del correo (MSF-532)

Spec `specs/20261016-130000-perfil-y-permisos-avanzados` · FR-012(b) · SC-004.
Guion: `scripts/verificar-salida-correo.mjs` (`pnpm correo:verificar-salida`).
Flujo de la pantalla: [Solicitar acceso](solicitar-acceso.md) · [Perfil y permisos avanzados (técnico)](tecnico/perfil-y-permisos.md).

## Estado

**Pendiente de ejecución en el servidor self-hosted.** La parte (b) de FR-012 exige que el aviso de
«Solicitar acceso» **salga realmente hacia afuera** y llegue a una casilla externa de prueba. El repo
registra el relay SMTP real y el SPF/DKIM del VPS como **pendientes** (ver
[Operación](tecnico/operacion.md)) y desde el repositorio no se puede confirmar que estén configurados. La
corrida **no se ejecutó** y **no hay evidencia**: la tabla de abajo queda en «pendiente» hasta que el
dueño la complete con la salida real del guion y la captura del correo recibido. No se inventa ningún
resultado.

`Desvío:` la tarea T013 del guion opt-in (épica MSF-148) queda cerrada sin la corrida real contra el
servidor: su requisito previo (relay SMTP con credenciales + SPF/DKIM del remitente) **no está confirmado**
en el VPS. Seguimiento: **MSF-532** — Tarea `seguimiento` «Ejecutar la verificación de salida del correo contra
el SMTP real del servidor self-hosted (FR-012b)», dueño: infraestructura / Nicolás; **a crear en el tracker**
(el repo no da fe de que esa tarea ya exista: la assessment de MSF-532 la dejó sin verificar). El guion
quedó endurecido para que esa corrida no pueda dar un **verde falso** (ver *Qué garantiza el guion*).

## Qué verifica

- **(a) Local** — el aviso llega a Mailpit: comprobación automática, con `MAILPIT_URL`.
- **(b) Servidor self-hosted** — el aviso sale por el SMTP real y llega a una casilla externa: la corrida
  dispara el flujo real y **la entrega se confirma a mano** (captura del correo recibido), porque desde el
  servidor no hay buzón que se pueda consultar por API.

El guion —la corrida real— es manual y opt-in: **no** corre en `pnpm test` ni en el CI (FR-012). Lo que sí
corre en el CI es la suite que prueba el guion contra un servidor local
(`scripts/verificar-salida-correo.test.mjs`, `pnpm test:correo:verificar-salida`, paso del job
`application`): ningún correo sale a internet. Esa suite detecta que el contrato `{resultado, nuevo, enviado}`
de la Edge Function y el guion sigan de acuerdo.

## Qué garantiza el guion

Esta tabla es la **única** definición de los códigos de salida: el guion
(`scripts/verificar-salida-correo.mjs`) y las páginas de técnica la apuntan, no la repiten.

| Código | Significado |
|---|---|
| `0` | **Verificado**: ESTA corrida envió el aviso y el mensaje llegó a Mailpit (sólo local). |
| `1` | Esta corrida **no** envió ningún aviso: falló el flujo, no hay administrador activo, el pedido del día ya estaba notificado (idempotencia) u otra invocación ganó el reclamo del envío. |
| `2` | Uso incorrecto: falta una variable de entorno. |
| `3` | ESTA corrida **envió** el aviso y el SMTP lo aceptó, pero la entrega **no** se puede verificar desde el servidor: queda pendiente la confirmación manual. |

Un `0` significa siempre «verificado por la máquina». En el servidor la corrida nunca devuelve `0`: por eso
el guion no puede usarse como prueba si nadie miró la casilla.

La función `solicitar-acceso` responde `{resultado, nuevo, enviado}`:

- `nuevo` — el pedido del día se creó en esa corrida.
- `enviado` — **esa** corrida envió el aviso y el SMTP lo aceptó.

El guion sólo acepta `0` (local) o `3` (servidor) si `enviado` es `true`. Con `enviado: false` la corrida no
mandó nada —el aviso ya salió hoy o lo está mandando otra invocación— así que no es evidencia, **aunque
haya un «Solicitud de acceso» en Mailpit**. Si la función no informa `enviado` (despliegue viejo), el guion
sale con `1` y pide actualizar la Edge Function: no adivina.

## Protocolo

1. Configurar en el servidor el relay real: secretos `GOTRUE_SMTP_*` de Supabase Auth y de la Edge
   Function `SMTP_HOST`, `SMTP_PORT` (`465`), `SMTP_TLS` (`true`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   (nombres en `supabase/functions/.env.example`; los valores **nunca** van a Git), más los registros
   DNS **SPF** y **DKIM** del remitente.
2. Confirmar que el **administrador activo** de la organización de prueba tiene como correo la casilla de
   prueba: el aviso va a los administradores de la organización, no a `CORREO_PRUEBA` directamente.
3. Correr el guion con las variables de entorno (ver abajo) y **anotar la salida tal cual**.
4. Confirmar a mano que el aviso llegó a la casilla externa y guardar la **captura** del correo.
5. Completar la tabla de abajo y dejar la evidencia en el PR de la historia.

Variables (los valores reales nunca se commitean):

| Variable | Para qué |
|---|---|
| `AUTH_URL` | Base de Supabase Auth del servidor self-hosted, p. ej. `https://supabase-<entorno>.<host-del-vps>/auth/v1` (nunca un host `*.supabase.co`: Supabase es self-hosted) |
| `FUNCTIONS_URL` | Base de Edge Functions del servidor self-hosted, p. ej. `https://supabase-<entorno>.<host-del-vps>/functions/v1` (nunca `*.supabase.co`) |
| `SUPABASE_ANON_KEY` | Clave anónima del proyecto |
| `ACCESO_EMAIL`, `ACCESO_PASSWORD` | Credenciales de una persona **sin** acceso a la sección |
| `SECCION` | Sección sin acceso para esa persona (por omisión `rentabilidad`) |
| `CORREO_PRUEBA` | Casilla externa donde se confirma la recepción (**obligatoria** sin `MAILPIT_URL`): `nicolas.m.jones@gmail.com` |
| `MAILPIT_URL` | Sólo local, p. ej. `http://127.0.0.1:4302` |

Para que la corrida sea concluyente el aviso tiene que salir **de esa corrida**: el flujo es idempotente por
día, así que si el pedido del día ya estaba notificado la corrida no vuelve a avisar (`enviado: false`) y el
guion sale con `1` diciéndolo. Si el envío de hoy falló (por ejemplo, el servidor todavía no tenía relay),
el reintento sí manda el aviso y el guion sale con `3`: es una corrida válida.

## Registro de la verificación

| Campo | Valor |
|---|---|
| Fecha | _pendiente_ |
| Entorno | _pendiente_ (stg / prd) |
| Ejecutó | _pendiente_ |
| Remitente (`SMTP_FROM`) | _pendiente_ |
| Destinatario real (administrador activo) | _pendiente_ |
| Casilla de la prueba (`CORREO_PRUEBA`) | _pendiente_ |
| Salida del guion (código y texto) | _pendiente_ |
| Captura del correo recibido | _pendiente_ |
| SPF/DKIM configurados | _pendiente_ |
| Resultado | _pendiente_ |

La verificación queda **verificada** cuando la tabla está completa con la salida real del guion, el
código `3` (aviso saliente, entrega por confirmar) y la captura del correo recibido en la casilla externa.
Con la tabla en «pendiente», FR-012(b) y SC-004 siguen **sin verificar**.
