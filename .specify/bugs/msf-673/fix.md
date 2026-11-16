# Bug Fix: la tienda pública manda al visitante a `/login` (404) y le cierra la sesión tras 12 h

- **Slug**: msf-673
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`main.tsx` instalaba el control de vencimiento (12 h) en todos los hosts: en una tienda, el primer clic de
un visitante que volvía al día siguiente disparaba `logout` + `/login` (ruta inexistente en la tienda → 404).
La base ya trae MSF-700, que resuelve el defecto: en la tienda el vencimiento cierra solo la sesión local
(`salirCliente`, scope local) y vuelve a `/`; en el panel sigue `logout` + `/login`. Se descartó la
implementación propia (`lib/arranque.ts`, `seguirActividadDelPanel` y sus tests) para no duplicar lógica.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts` | added | E2E `[MSF-673:MSF-673]` (fixture de evidencia): marca adelantada 13 h, primer clic; exige que no haya `/login`, ni 404, ni revocación global, y que el destino sea `/`. |
| `docs/tiendas-online.md`, `docs/acceso-ingreso.md`, `docs/e2e-app.md` | modified | Vencimiento en la tienda = cierre local + vuelta a `/`; recorrido nuevo en la cobertura E2E. |

## Tests Added or Updated

- `apps/web/e2e/tienda-sesion-vencimiento.e2e.ts::[MSF-673:MSF-673] en la tienda, tras más de 12 h sin actividad el primer clic no manda a /login, no revoca globalmente y vuelve a /`

## Follow-ups

- Tarea `seguimiento` MSF-740 (dueño: épica MSF-237 / F-CLI-06): decidir si la tienda quiere regla propia de inactividad.

## Actualización al integrar `dokploy` (MSF-700)

La base ya trae MSF-700: en la tienda el vencimiento cierra solo la sesión local (`salirCliente`) y vuelve a `/`; en el panel sigue `logout` + `/login`. Cumple lo aprobado para MSF-673 (no `/login` ni cierre global en la tienda), así que se descartó `lib/arranque.ts`, `seguirActividadDelPanel` y sus tests para no duplicar la lógica. Queda el E2E `tienda-sesion-vencimiento` como regresión.
