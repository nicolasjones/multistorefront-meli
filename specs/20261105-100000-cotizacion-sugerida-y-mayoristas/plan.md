# Plan de implementación: Precios y dólar · Cotización sugerida y mayoristas

**Spec**: [spec.md](spec.md) · **Estado**: provisional (NEEDS_INFO). Solo planifica F-PRE-13; F-PRE-14 no tiene plan.

## Enfoque (F-PRE-13)

- Un servicio de lectura de la fuente pública que entrega el valor sugerido a `Cotizacion` (diálogo F-PRE-02 de MSF-116). **Dónde corre** (Edge Function, worker o Kestra) depende de la Pregunta 1; secretos solo en `.env.example`, nunca en el navegador.
- Si hace falta una Edge Function: declarar request/respuestas/errores en `openapi/*.json` y las RPC en `contracts/cotizacion-sugerida.md` (firma + `BREAKING:` si cambia algo existente). Hoy no se declara ninguna firma: no existe ni está decidida.
- El diálogo muestra la sugerencia y la carga/confirmación siguen siendo las de MSF-116; si la fuente falla, la carga manual no cambia.
- Datos: ninguna tabla nueva decidida. Si se cachea la sugerencia, sería `dominio`, con RLS por organización y migración aditiva con reversión.
- Docs: actualizar `docs/precios.md` (Constitución, documentación obligatoria).

## Constitución

Principio VII: sin tablas declaradas aún (re-verificar al decidir). Principio VIII: la cotización es de la organización; no depende de la empresa activa. Principio VI: usa los patrones compartidos de carga/error del diálogo.

## F-PRE-14

Sin plan hasta resolver Preguntas 2–3.
