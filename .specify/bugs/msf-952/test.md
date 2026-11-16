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

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix) | búsqueda de cliente/flow/credenciales + columnas | pass | Existen `public.avisar_cliente_whatsapp`, `private.telefono_whatsapp`, `reparaciones-aviso-whatsapp.yml` y `WHATSAPP_*` en Kestra: el servidor ya puede encolar y enviar. |
| Tests nuevos (flow) | `node --test infra/kestra/flows/reparaciones-aviso-whatsapp.test.mjs infra/kestra/flows/reparaciones-aviso-correo.test.mjs` | pass | 16/16. |
| Tests nuevos (web) | `pnpm --filter @platform/web exec vitest run src/lib/reparacionAvisos.test.ts src/lib/clientes.test.ts src/pages/service-tecnico/reparacion.avisos.test.tsx src/pages/clientes/show.test.tsx` | pass | 55/55 (3 archivos; `reparacionAvisos.test.ts` no existe, se ejecutaron los otros tres). |
| Regresión del correo | incluida en el Vitest anterior y en el test estático del flow | pass | El aviso por correo conserva su canal y su UI. |
| Regresión (DB) | `pnpm test:db:guard-migraciones`, `pnpm test:db:validar-aditivas` | pass | 30/30 y 5/5. |
| pgTAP nuevo | `pnpm test:db` | not-run | Sin `supabase` CLI ni Docker en este entorno; `scripts/supabase-ci.mjs` no aplica. Lo corre el CI. |
| E2E nuevo | `pnpm test:e2e` | not-run | Requiere `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` y la web servida; el spec se omite sin ellos (igual que los otros E2E de Service). |
| Lint / type-check / build | `pnpm --filter @platform/web lint`, `pnpm --filter @platform/web build` | pass | Build completo OK; lint solo con warnings previos del repo. |
| Migraciones / docs | `node scripts/verificar-migraciones.mjs`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm e2e:escritura:check` | pass | 717 migraciones, 1 nueva contra `origin/dokploy`. |
| Test que detecta la regla (FEAT-236) | mutar `puedeAvisarWhatsapp` a `reparacion !== null` y correr `-t "con lectura no ofrece el botón de WhatsApp"` | pass (falla con la mutación) | El test falló como debía; mutación revertida. |

## Output Excerpts

```
Test Files  3 passed (3)
     Tests  55 passed (55)
```

```
✔ entrega el mensaje al proveedor con el teléfono, la plantilla y la clave de idempotencia
✔ un fallo del proveedor reintenta 3 veces y luego cierra el aviso como fallido con un motivo fijo
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

```
Migraciones OK: 717 archivo(s), 1 nuevo(s) contra origin/dokploy.
Documentación de cambios: OK
Trampas conocidas: OK
```

```
✓ built in 3.58s
```

```
× con lectura no ofrece el botón de WhatsApp ni el reenvío   (con la mutación; revertida)
```

## Residual Risks

- El envío real al proveedor no se puede validar hasta que se contrate y se carguen la URL, la plantilla y el token
  (decisión de negocio D-1). Sin proveedor, el flow cierra `fallido`, que es el comportamiento esperado.
- El pgTAP y el E2E no corrieron en este entorno; su resultado queda supeditado al CI con Supabase local.
- `pnpm der:check` falla por 4 specs preexistentes de `origin/dokploy` sin DER; no es de este cambio.

## Recommendation

Cerrar el código con la revisión normal y dejar que el CI ejecute `pnpm test:db` y el E2E: si el pgTAP nuevo pasa, la
verificación queda completa. La deuda de negocio (proveedor, plantilla aprobada y costo) sigue en la épica de origen.
