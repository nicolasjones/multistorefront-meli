# Bug Verification: envío automático de WhatsApp con proveedor (MSF-952 · S-1 de MSF-118)

- **Slug**: msf-952
- **Tested**: 2026-11-16
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

La ausencia que describe el assessment ya no existe: hay modelo (`canal`, `clave_envio`, consentimiento), RPC de
encolado, flow de Kestra, configuración del proveedor, pantalla e historial por canal. Los tests estáticos, Vitest,
lint, build y los guards de migraciones/documentación pasan. Queda **sin ejecutar localmente** el pgTAP y el E2E
porque este entorno no tiene `supabase` CLI ni Docker; los corre el CI con `pnpm dev:supabase`.

**El CI de la rama dejó el job `database` y el `e2e-tienda` en rojo**: la migración no llegó a aplicarse (error de
sintaxis en el `for` de `private.telefono_whatsapp`) y, revisada a mano, tenía un defecto de fondo: un aviso de
WhatsApp pendiente tapaba al aviso de correo. Las dos cosas están corregidas (ver `fix.md`); el pgTAP nuevo cubre la
convivencia de los dos canales y el CI es el que lo ejecuta.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | búsqueda de cliente/flow/credenciales + columnas | pass | Existen `public.avisar_cliente_whatsapp`, `private.telefono_whatsapp`, `reparaciones-aviso-whatsapp.yml` y `WHATSAPP_*` en Kestra: el servidor ya puede encolar y enviar. |
| Tests nuevos (flow) | `node --test infra/kestra/flows/reparaciones-aviso-whatsapp.test.mjs` | pass | 8/8. |
| Tests nuevos (web) | `pnpm --filter @platform/web exec vitest run src/pages/service-tecnico/reparacion.avisos.test.tsx src/pages/clientes/show.test.tsx src/lib/whatsapp.test.ts` | pass | 79/79 (3 archivos). |
| Regresión del correo | pgTAP nuevo (convivencia de canales) + Vitest de `reparacion.avisos` | pass (pgTAP corre en el CI) | La RPC de correo se recrea con el filtro `canal = 'correo'`: el aviso de WhatsApp pendiente no la tapa. |
| Regresión (DB) | `pnpm test:db:guard-migraciones`, `pnpm test:db:validar-aditivas`, `pnpm db:validar:aditivas` | pass | 30/30, 5/5 y 717 migraciones sin destructivas sin reversión. |
| pgTAP nuevo | `pnpm test:db` | not-run | Sin `supabase` CLI ni Docker en este entorno; `scripts/supabase-ci.mjs` no aplica. Lo corre el CI. |
| E2E nuevo | `pnpm test:e2e` | not-run | Requiere `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y la web servida; el spec se omite sin ellos (igual que los otros E2E de Service). |
| Lint / type-check / build | `pnpm lint`, `pnpm build` | pass | Build completo OK (3.5 s); lint exit 0, solo warnings previos del repo. |
| Migraciones / docs | `node scripts/verificar-migraciones.mjs`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm e2e:escritura:check`, `pnpm prototipo:check`, `pnpm ui:empresas:check` | pass | 717 migraciones, 1 nueva contra `origin/dokploy`. |
| Estructura de la migración | balanceador de bloques PL/pgSQL sobre las 8 funciones y el bloque `DO` | pass | `begin`/`case`/`end`, `if`/`end if` y `for`/`end loop` balanceados; el cuerpo de la RPC de correo es idéntico al original salvo el filtro del canal. |
| Calidad | `pnpm calidad` | pass (gitleaks not-run) | oxlint, knip, jscpd, dependency-cruiser y syncpack OK; gitleaks necesita Docker (sin permisos acá) — el job `quality` del CI lo corrió verde. |
| Test que detecta la regla (FEAT-236) | mutar `puedeAvisarWhatsapp` a `reparacion !== null` y correr `-t "con lectura no ofrece el botón de WhatsApp"` | pass (falla con la mutación) | El test falló como debía; mutación revertida. |

## Output Excerpts

```
Test Files  3 passed (3)
     Tests  79 passed (79)
```

```
✔ entrega el mensaje al proveedor con el teléfono, la plantilla y la clave de idempotencia
✔ un fallo del proveedor reintenta 3 veces y luego cierra el aviso como fallido con un motivo fijo
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

```
Migraciones OK: 717 archivo(s), 1 nuevo(s) contra origin/dokploy.
717 migraciones verificadas en supabase/migrations: ninguna destructiva sin camino de reversión documentado.
Documentación de cambios: OK
Trampas conocidas: OK
```

```
✓ built in 3.54s
```

```
× con lectura no ofrece el botón de WhatsApp ni el reenvío   (con la mutación; revertida)
```

## Residual Risks

- El envío real al proveedor no se puede validar hasta que se contrate y se carguen la URL, la plantilla y el token
  (decisión de negocio D-1). Sin proveedor, el flow cierra `fallido`, que es el comportamiento esperado.
- El pgTAP y el E2E no corrieron en este entorno; su resultado queda supeditado al CI con Supabase local. La
  migración se revisó a mano (balance de bloques y diff del cuerpo de la RPC de correo contra el original), pero la
  primera aplicación real es la del CI.
- `pnpm der:check` falla por 4 specs preexistentes de `origin/dokploy` sin DER; no es de este cambio.

## Recommendation

Cerrar el código con la revisión normal y dejar que el CI ejecute `pnpm test:db` y el E2E: si el pgTAP nuevo pasa, la
verificación queda completa. La deuda de negocio (proveedor, plantilla aprobada y costo) sigue en la épica de origen.
