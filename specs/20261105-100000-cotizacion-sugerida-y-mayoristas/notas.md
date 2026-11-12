# Notas de la épica MSF-373 (cotización sugerida)

## Lecciones

- Una función Edge nueva no queda registrada en dev hasta recrear el stack del runtime (ver `docs/precios.md`, «Cotización sugerida»).
- commitlint limita el título del commit a 100 caracteres: un título de 101 obligó a reabrir la rama.
- Cuando una spec parcial (NEEDS_INFO) se implementa con una decisión provisoria, hay que reescribir spec y plan en el mismo PR (acá quedaron desfasados y se corrigieron después).

## Decisiones tomadas (2026-11-12)

- **Fuente y valor de F-PRE-13:** DolarApi, dólar oficial (venta). Aprobada por Nicolás el 2026-11-12 («avanza con todo»)
- **F-PRE-14 (MSF-442, listas mayoristas): CANCELADA.** Choca con F-PRE-15 (escalas por tipo de cliente), que ya está implementada en «Tipos de cliente». Aprobada por Nicolás el 2026-11-12 («avanza con todo»)

## Pendientes de Nicolás

Ninguno de esta épica.

## Documentador final (2026-11-12)

Auditoría de `docs/*.md` y specs contra `origin/dokploy` (migraciones, RPC, componentes y ayuda en `apps/web/src/ayuda`). Solo documentación.

- `docs/precios.md`: el contrato de la Edge Function decía `fecha: string`; el código devuelve `string | null` (`handler.ts`, `leerSugerencia`). Corregido y aclarado `fuente`.
- `docs/deployment.md`: agregado que la fuente es DolarApi (`dolarapi.com`, oficial venta, 5 s, sin redirecciones) junto a la salida a internet, y la nota de «Function not found» tras crear una función nueva.
- `docs/roadmap-template.md`: la fila de MSF-373 nombra DolarApi y su requisito de salida; F-PRE-14 sigue **Cancelada**.
- Verificado sin cambios: mensajes del diálogo (`DialogoCargarDolar.tsx`), ayuda de «Cotización del dólar», script `test:edge:cotizacion-sugerida`.
- `docs/producto/` y `docs/tecnico/` no existen en `dokploy` (viven en `main`): `docs/tecnico/cotizacion-sugerida-y-mayoristas.md` de `main` sigue con F-PRE-14 como abierta; hay que actualizarlo en un PR a `main`.
