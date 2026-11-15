# Plan de implementación: Precios y dólar · Cotización sugerida y mayoristas

**Spec**: [spec.md](spec.md) · **Estado**: provisional (NEEDS_INFO). Solo planifica F-PRE-13; F-PRE-14 está cancelada y no tiene plan.

## Enfoque (F-PRE-13)

- Un servicio de lectura de la fuente pública que entrega el valor sugerido a `Cotizacion` (diálogo F-PRE-02 de MSF-116). **Dónde corre** (Edge Function, worker o Kestra) depende de la Pregunta 1; secretos solo en `.env.example`, nunca en el navegador.
- Si hace falta una Edge Function: declarar request/respuestas/errores en `openapi/*.json` y las RPC en `contracts/cotizacion-sugerida.md` (firma + `BREAKING:` si cambia algo existente). Hoy no se declara ninguna firma: no existe ni está decidida.
- El diálogo muestra la sugerencia y la carga/confirmación siguen siendo las de MSF-116; si la fuente falla, la carga manual no cambia.
- Datos: ninguna tabla nueva decidida. Si se cachea la sugerencia, sería `dominio`, con RLS por organización y migración aditiva con reversión.
- Docs: actualizar `docs/precios.md` (Constitución, documentación obligatoria).

## Módulos y archivos tocados (implementado)

- `supabase/functions/cotizacion-sugerida/` (`index.ts`, `handler.ts`, pruebas): Edge Function, solo POST, exige `edicion` en `cotizacion_dolar`, lee DolarApi (oficial, venta) con tope de 5 s y sin redirecciones.
- `apps/web/src/components/cotizacion/DialogoCargarDolar.tsx`, `apps/web/src/hooks/useCotizacionSugerida.ts`, `apps/web/src/lib/cotizacion.ts`: la sugerencia y «Usar este valor» en el diálogo.
- `package.json` (script `test:edge:cotizacion-sugerida`), `docs/precios.md`, `docs/roadmap-template.md`.
- **Tablas y migraciones: ninguna.** Sin `openapi/` (la función no es API pública; el contrato está en `docs/precios.md`).
- Solape: cualquier épica que toque `DialogoCargarDolar.tsx` o la configuración del dólar (p. ej. MSF-352) va en serie con esta.

## Constitución

Principio VII: sin tablas declaradas aún (re-verificar al decidir). Principio VIII: la cotización es de la organización; no depende de la empresa activa. Principio VI: usa los patrones compartidos de carga/error del diálogo.

## F-PRE-14

Cancelada (decisión de Nicolás, 2026-11-12): no tendrá plan.
