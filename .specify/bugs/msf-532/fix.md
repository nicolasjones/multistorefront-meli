# Bug Fix: Verificación de salida del correo de «Solicitar acceso» sin verde falso (MSF-532)

- **Slug**: msf-532
- **Fixed**: 2026-11-14
- **Assessment**: ./assessment.md
- **Status**: partial

## Summary

El guion de verificación de salida (`scripts/verificar-salida-correo.mjs`) ya no puede dar un **verde falso**:
en el servidor nunca termina con código `0` (el `0` significa «verificado por la máquina», que sólo es
posible contra Mailpit), la casilla de prueba es obligatoria sin `MAILPIT_URL` y una corrida cuyo pedido del
día ya estaba notificado no se toma como verificación. Además queda **registrada** la verificación externa
con su estado real (pendiente) y su dueño, en lugar de una tarea cerrada sin evidencia.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/verificar-salida-correo.mjs` | modified | Códigos de salida documentados; `CORREO_PRUEBA` obligatoria sin Mailpit; se usa el contrato `{resultado, nuevo}` para saber si la corrida envió un aviso nuevo; en el servidor sale con `3` (verificación manual pendiente) y nunca con `0`. |
| `scripts/verificar-salida-correo.test.mjs` | added | 10 casos (`node --test`) que corren el guion real contra un servidor local que imita Auth, la Edge Function y Mailpit: ningún correo sale a internet. |
| `docs/verificacion-salida-correo.md` | added | Registro de la verificación con los campos en «pendiente», el protocolo y los códigos de salida. |
| `docs/README.md` | modified | Página en la tabla de funcionalidad y deuda trazada (MSF-532). |
| `docs/tecnico/operacion.md` | modified | El «Pendiente» difuso pasa a estado con dueño, seguimiento y enlace al registro. |
| `docs/tecnico/perfil-y-permisos.md` | modified | Verificación de salida (FR-012) con los códigos de salida y el enlace al registro. |
| `docs/solicitar-acceso.md` | modified | Límite «el envío depende del SMTP» con el estado real de la verificación. |
| `docs/deployment.md` | modified | Sección «Relay SMTP del servidor (MSF-532)»: relay + SPF/DKIM, estado y dueño. |
| `package.json` | modified | `test:correo:verificar-salida` y su entrada en la cadena `test`. |

## Diff Highlights

```js
// scripts/verificar-salida-correo.mjs (antes: verde falso)
if (!mailpit) {
  console.log(`Sin MAILPIT_URL: confirmá a mano que el aviso llegó a ${...}`)
  process.exit(0)          // ← 0 sin comprobar nada
}

// scripts/verificar-salida-correo.mjs (ahora)
if (!avisoNuevo) {         // contrato {resultado, nuevo}: el pedido del día ya estaba notificado
  console.error('La corrida no confirmó un aviso nuevo: ...')
  process.exit(1)
}
console.log('VERIFICACIÓN MANUAL PENDIENTE: esto NO es evidencia de que el correo haya llegado.')
process.exit(3)            // ← nunca 0 en el servidor
```

## Tests Added or Updated

- `scripts/verificar-salida-correo.test.mjs::la Edge Function sigue respondiendo el contrato {resultado, nuevo} que usa el guion` — el guion depende de ese contrato; si la función lo cambia, el guion queda mintiendo.
- `scripts/verificar-salida-correo.test.mjs::sin CASILLA ni MAILPIT_URL el guion no corre: falta la variable` — sin casilla de prueba no se corre.
- `scripts/verificar-salida-correo.test.mjs::sin una variable de entorno obligatoria el guion falla con el código de uso` — código `2`.
- `scripts/verificar-salida-correo.test.mjs::si no se puede iniciar sesión el guion falla sin dar verde` — código `1`.
- `scripts/verificar-salida-correo.test.mjs::sin administrador activo el guion falla sin dar verde` — código `1`.
- `scripts/verificar-salida-correo.test.mjs::una respuesta inesperada de la función no se toma como envío` — código `1`.
- `scripts/verificar-salida-correo.test.mjs::el pedido del día ya notificado no se toma como verificación (idempotencia)` — código `1`, nunca `0`.
- `scripts/verificar-salida-correo.test.mjs::en el servidor la entrega queda pendiente de confirmación manual: nunca verde` — código `3`, nunca `0`.
- `scripts/verificar-salida-correo.test.mjs::en local, con el aviso en Mailpit, la salida queda verificada` — código `0` sólo con el mensaje encontrado.
- `scripts/verificar-salida-correo.test.mjs::en local, sin aviso nuevo en Mailpit, no hay verde` — código `1`.

## Local Verification

- Commands run: `node --test scripts/verificar-salida-correo.test.mjs` → 10/10 en verde.
- Commands run: `node scripts/docs-check.mjs` → los 25 errores son los preexistentes (enlaces a `specs/` fuera de `docs/`); la página nueva no suma ninguno.
- Comprobación de que los tests vigilan la regla: se cambió a propósito `process.exit(3)` por `process.exit(0)` y el test «en el servidor la entrega queda pendiente de confirmación manual» falla; se cambió a propósito `cuerpo.nuevo === true` por `true` y falla el test de idempotencia. Se revirtió cada cambio.
- Manual checks: la corrida real contra el SMTP del servidor self-hosted **no se ejecutó** (ver *Residual*).

## Deviations from Assessment

- **El contrato de la respuesta no se cambió**: la assessment propone usar `{resultado, nuevo}`; se usó tal cual, sin tocar `supabase/functions/solicitar-acceso/handler.ts` ni su OpenAPI. Con `nuevo: true` el pedido del día se creó en esa corrida, así que el aviso salió en ella; con `nuevo: false` la respuesta no permite distinguir «ya se notificó hoy» de «reintento que volvió a avisar», y el guion lo dice sin afirmar lo que no sabe.
- **No se editó `specs/20261016-130000-perfil-y-permisos-avanzados/tasks.md`**: la consigna de la corrida indica que las marcas y notas las escribe el runner en `specs/<slug>/tasks/<CODE>.md`. El cierre equivalente (estado + desvío + seguimiento con dueño) queda en `docs/verificacion-salida-correo.md`, `docs/README.md` y este informe.
- **El registro se llama `docs/verificacion-salida-correo.md`** (la assessment proponía ese nombre) y se agregaron además `docs/deployment.md` (estado del relay y SPF/DKIM) y `package.json` (cableado del test nuevo), que la assessment listaba como archivos a cambiar.

## Follow-ups

- **Tarea `seguimiento` (MSF-532, dueño: infraestructura/Nicolás)**: configurar el relay SMTP real en el VPS (secretos `GOTRUE_SMTP_*` y `SMTP_HOST`/`SMTP_PORT=465`/`SMTP_TLS=true`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`) y los registros DNS SPF/DKIM; correr `pnpm correo:verificar-salida` con `CORREO_PRUEBA`; adjuntar la salida del guion y la captura del correo recibido; completar el registro de `docs/verificacion-salida-correo.md`.
- Mientras tanto, FR-012(b) y SC-004 siguen **sin verificar**: el estado del repo lo dice en vez de darlo por hecho.
