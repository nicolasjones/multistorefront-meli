# Bug Verification: Verificación de salida del correo de «Solicitar acceso» sin verde falso (MSF-532)

- **Slug**: msf-532
- **Tested**: 2026-11-14
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El **defecto de instrumental** (el guion podía terminar con código `0` sin comprobar nada y sin haber
enviado ningún correo) queda reproducido y corregido: hay tests que fallan con el guion viejo y pasan con
el nuevo. La **verificación externa** en sí (que el correo salga del servidor self-hosted y llegue a una
casilla externa real) **no se ejecutó** y no puede ejecutarse desde esta sesión: falta el relay SMTP real
en el VPS, que es infraestructura de Nicolás. El estado queda registrado como pendiente, con dueño y
seguimiento, en vez de cerrado como si hubiera pasado.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test scripts/verificar-salida-correo.test.mjs` | pass | 10/10; el guion sale con `1`/`2`/`3` en los casos que antes salía con `0`. |
| New / updated tests | `node --test scripts/verificar-salida-correo.test.mjs` | pass | Corre el guion real contra un servidor local (Auth + Edge Function + Mailpit simulados); ningún correo sale a internet. |
| Test que vigila la regla (mutación) | `process.exit(3)` → `process.exit(0)` | pass (detecta) | Falla el test «en el servidor la entrega queda pendiente de confirmación manual: nunca verde». |
| Test que vigila la regla (mutación) | `cuerpo.nuevo === true` → `true` | pass (detecta) | Falla el test «el pedido del día ya notificado no se toma como verificación (idempotencia)». |
| Regression suite (docs) | `node scripts/docs-check.mjs` | pass | Los 25 errores son los preexistentes (enlaces a `specs/` fuera de `docs/`); la página nueva no suma ninguno. |
| Regression suite (docs) | `node --test scripts/verificar-documentacion-cambios.test.mjs` | pass | El cambio toca `scripts/` y actualiza `docs/` y `.specify/bugs/`. |
| Regression suite (docs) | `node --test scripts/tests/documentacion-importaciones.test.mjs scripts/tests/documentacion-pasos-manuales-vps2.test.mjs` | pass | 3/3 y 15/15. |
| Lint / type-check | `pnpm lint` | pass | `oxlint` del área web: sin cambios en `apps/web`, igual que en la base. |
| Build | `pnpm build` | pass | Vite build de `@platform/web` en verde. |
| Verificación externa (servidor self-hosted) | `pnpm correo:verificar-salida` contra stg/prd | not-run | Requiere el relay SMTP real en el VPS (no existe todavía) y una casilla externa real. Es la parte de FR-012(b) que sigue **sin verificar**. |

## Output Excerpts

```
✔ la Edge Function sigue respondiendo el contrato {resultado, nuevo} que usa el guion
✔ el pedido del día ya notificado no se toma como verificación (idempotencia)
✔ en el servidor la entrega queda pendiente de confirmación manual: nunca verde
✔ en local, con el aviso en Mailpit, la salida queda verificada
✔ en local, sin aviso nuevo en Mailpit, no hay verde
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

Con la mutación `process.exit(3)` → `process.exit(0)` (el verde falso):

```
✖ en el servidor la entrega queda pendiente de confirmación manual: nunca verde
ℹ pass 8
ℹ fail 1
```

## Residual Risks

- **FR-012(b) y SC-004 siguen sin verificar**: nobody corrió el flujo contra el SMTP real del servidor ni
  confirmó la recepción en una casilla externa. El registro `docs/verificacion-salida-correo.md` queda en
  «pendiente» y el seguimiento es la Tarea `seguimiento` de MSF-532 (dueño: infraestructura/Nicolás).
- **El `0` del guion significa «verificado por Mailpit»**: desde el servidor nunca hay `0`, así que la
  corrida real hay que cerrarla con la confirmación manual (código `3` + captura). Si alguien Busca un
  «verde» en el servidor, no lo va a encontrar: es a propósito.
- **La idempotencia por día limita la corrida**: para que el pedido sea nuevo hace falta otra persona u
  otra sección; el guion lo avisa en el mensaje, pero el operador tiene que elegir esos datos.
- El resto de funciones que comparten el SMTP (avisos de faltantes, resúmenes, correo a proveedor) siguen
  dependiendo del mismo relay: que no esté configurado no es un problema sólo de «Solicitar acceso».

## Recommendation

**Cerrar el bug como `partial`**: el defecto de instrumental está corregido y guardado con tests, y la
verificación externa quedó **traced** con dueño y estado real (no como «hecho»). La historia se da por
resuelta en el repo cuando la Tarea `seguimiento` de MSF-532 corra el guion contra el relay del VPS y
complete el registro con la salida y la captura; hasta entonces, FR-012(b) sigue abierta por
infraestructura.
