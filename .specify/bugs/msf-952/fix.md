# Bug Fix: envío automático de WhatsApp con proveedor de mensajería (S-1 de MSF-118)

- **Slug**: msf-952
- **Fixed**: 2026-11-16
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se implementó el seguimiento **S-1** de MSF-118: el aviso de estado de una reparación ya no depende de que una persona
abra un enlace `wa.me`, sino que el **servidor** encola el aviso y un flow de Kestra lo entrega a un proveedor de
mensajería, con los estados `pendiente → enviado/fallido` del mismo modelo y sin tocar el aviso por correo. El envío
exige **consentimiento** del cliente (`dominio.clientes.acepta_whatsapp`) y un **teléfono válido**; sin uno de los dos
no se crea ningún aviso ni orden en la outbox. El proveedor concreto sigue siendo una decisión de negocio (D-1): hasta
que se contrate, la URL y el token quedan vacíos y el flow cierra los avisos como `fallido`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270418000403_reparacion_avisos_whatsapp_envio.sql` | added | Aditiva: `canal` y `clave_envio` en `dominio.reparacion_avisos`; índice pendiente por canal + clave única; `acepta_whatsapp`/`acepta_whatsapp_en` en `dominio.clientes`; `private.telefono_whatsapp`; `public.avisar_cliente_whatsapp`; `avisos_de_reparacion` con `canal`; funciones del flow por canal. Reversión documentada en el encabezado. |
| `supabase/tests/database/service_aviso_whatsapp.test.sql` | added | pgTAP: modelo, privilegios, consentimiento, teléfono, RPC, idempotencia, outbox, actividad sin el número y cierre por canal. |
| `infra/kestra/flows/reparaciones-aviso-whatsapp.yml` | added | Flow `producto.service` que reclama `enviar-aviso-whatsapp-*`, entrega `{ telefono, mensaje, plantilla, clave }`, cierra como enviado y fallido con motivo fijo; 3 reintentos, cron cada minuto. |
| `infra/kestra/flows/reparaciones-aviso-whatsapp.test.mjs` | added | Contrato estático del flow (reclamo, secreto, plantilla sin importes, reintentos, cierre idempotente). |
| `infra/kestra/.env.example`, `infra/kestra/compose.yaml` | modified | `WHATSAPP_API_URL`, `WHATSAPP_PLANTILLA`, `SECRET_WHATSAPP_TOKEN` (placeholder base64). |
| `apps/web/src/lib/reparacionAvisos.ts`, `apps/web/src/hooks/useAvisosReparacion.ts` | modified | RPC `avisar_cliente_whatsapp`, mensajes de error y acción `avisarWhatsapp`. |
| `apps/web/src/components/service/AvisosReparacion.tsx`, `apps/web/src/pages/service-tecnico/reparacion.tsx` | modified | Botón «Avisar por WhatsApp» y «Reenviar» por el canal del aviso. |
| `apps/web/src/lib/clientes.ts`, `apps/web/src/pages/clientes/show.tsx` | modified | Interruptor «Acepta avisos por WhatsApp» en «Comunicaciones» de la ficha. |
| `apps/web/src/pages/service-tecnico/reparacion.avisos.test.tsx` | modified | Vitest del botón, los rechazos, el historial por canal, el reenvío y el rol de lectura. |
| `apps/web/src/pages/clientes/show.test.tsx` y fixtures de clientes | modified | Campo nuevo en los dobles de prueba y test del guardado del consentimiento. |
| `apps/web/e2e/service-aviso-whatsapp.e2e.ts` | added | E2E `[MSF-952:S1]` con el fixture de evidencia: consentimiento en la ficha y aviso encolado con `canal = 'whatsapp'`. |
| `package.json` | modified | `test:kestra:reparaciones-aviso-whatsapp` en el suite. |
| `docs/service-avisos.md`, `docs/actividad.md`, `docs/clientes.md`, `docs/tecnico/datos.md` | modified | Guía del canal, evento de actividad, consentimiento y columnas nuevas. |

## Deviations from Assessment

- El assessment recomendaba una spec nueva de Spec Kit; el pedido del runner (MSF-952 en **modo bug**) manda el flujo
  `speckit-bug-assess → fix → test`. Se implementó el alcance de S-1 tal como lo describe la épica MSF-118.
- El assessment proponía sumar el modelo `canal` apoyado en F-SVC-30 (click-to-chat). F-SVC-30 **no está implementada**
  y sus filas `abierto` no existen; en vez de inventarlas, esta historia agrega el `canal` que el correo ya necesitaba y
  deja el click-to-chat fuera. No se duplica el modelo: `whatsapp` es otro canal del mismo aviso.
- El proveedor concreto no se elige ni se contrata acá (decisión de negocio de Nicolás, D-1). El código habla con un
  contrato mínimo por variables de entorno; sin proveedor configurado el flow cierra `fallido`.
- Se integró `origin/dokploy` por merge antes de cerrar: `public.clientes` ya se había movido a `dominio.clientes`
  (MSF-505/882), así que la migración y el pgTAP usan `dominio.clientes`. La versión de migración que asigna el runner
  es `20270418000403` (por encima del máximo real `20270418000402`).

## Tests Added or Updated

- `supabase/tests/database/service_aviso_whatsapp.test.sql` — modelo/checks/índices/privilegios, consentimiento y
  fecha, normalización del teléfono, rechazos `42501`/`55000`/`P0002`/`22023`, idempotencia, outbox, convivencia con el
  correo, historial con canal, cierre `enviado`/`fallido`, motivo saneado y vencimiento a los 15 minutos.
- `infra/kestra/flows/reparaciones-aviso-whatsapp.test.mjs` — contrato del flow.
- `apps/web/src/pages/service-tecnico/reparacion.avisos.test.tsx` — botón, mensajes `sin_consentimiento`/
  `sin_telefono`, reenvío por canal, rol `lectura` sin acción.
- `apps/web/src/pages/clientes/show.test.tsx` — el interruptor guarda `acepta_whatsapp`.
- `apps/web/e2e/service-aviso-whatsapp.e2e.ts` — recorrido de pantalla (se omite sin `SUPABASE_URL`).

## Local Verification

- `pnpm --filter @platform/web exec vitest run …` (reparacion.avisos, clientes, show) → 55 tests, 0 fallos.
- `node --test infra/kestra/flows/reparaciones-aviso-whatsapp.test.mjs …` → 16 tests, 0 fallos.
- `pnpm --filter @platform/web lint` → OK (solo warnings previos del repo).
- `pnpm --filter @platform/web build` → OK.
- `pnpm test:db:guard-migraciones` y `pnpm test:db:validar-aditivas` → 30 y 5 tests, 0 fallos.
- `pnpm docs:check` → OK; `node scripts/verificar-migraciones.mjs` → 717 archivos, 1 nuevo contra `origin/dokploy`.
- `pnpm test:kestra:deploy-flow`, `pnpm e2e:escritura:check`, `pnpm matriz:check` → OK.
- **No ejecutado localmente**: `pnpm test:db` (pgTAP) y `pnpm test:e2e` porque no hay `supabase` CLI ni Docker en este
  entorno; quedan para el CI con `pnpm dev:supabase`.

## Follow-ups

- Contratar el proveedor de mensajería, cargar `WHATSAPP_API_URL`/`WHATSAPP_PLANTILLA`/`SECRET_WHATSAPP_TOKEN` y
  aprobar la plantilla transaccional (S-1 y S-4 de MSF-118). Queda trazado en la épica de origen.
- `pnpm der:check` falla por cuatro specs preexistentes de `origin/dokploy` sin `## Modelo de datos (DER)`
  (rentabilidad-margen, cuentas-y-compras-a-proveedores, cotizacion-sugerida-y-mayoristas,
  ordenes-de-compra-a-proveedores). No lo introduce este cambio.
