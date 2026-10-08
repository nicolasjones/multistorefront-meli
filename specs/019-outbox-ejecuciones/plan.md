# Plan de implementación: Despacho confiable de ejecuciones

**Rama**: `019-outbox-ejecuciones` | **Fecha**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

## Resumen

Extender `ejecuciones_worker` con una outbox durable y reclamos recuperables.
La solicitud manual persiste ejecución y orden en una transacción; Kestra
reclama órdenes con privilegio mínimo. Los productos mantienen sus flows y
workers concretos. No hay HTTP desde triggers SQL.

## Contexto técnico

**Lenguaje**: PostgreSQL/Supabase, YAML Kestra 1.3.35, TypeScript existente.  
**Dependencias**: Postgres, RLS y roles existentes; Kestra OSS.  
**Persistencia**: `public.ejecuciones_worker` y nueva outbox `public`; sin secretos, URLs ni comandos de worker.  
**Pruebas**: pgTAP de atomicidad, RLS, reclamo exclusivo, vencimiento e idempotencia; `pnpm infra:config:kestra`; recorrido real en el producto.  
**Plataforma**: Supabase local/cloud y Kestra VPS, sin servicio o Compose nuevo.  
**Límites**: migraciones aditivas; sin API Node, Redis, cola externa, conector ni tabla `dominio`.

## Decisiones

1. La outbox es uno-a-uno con una ejecución autorizada.
2. La función de inicio escribe ambos registros; no existe `pg_net`, URL de webhook ni secreto de despacho.
3. Kestra reclama lotes con exclusión mutua y vencimiento; confirma, libera o agota un intento.
4. El template aporta contrato; el producto resuelve flow, worker y capacidad concreta.
5. La adopción comienza por solicitudes manuales y migra schedules sin disparos duplicados.

## Chequeo constitucional

| Principio | Resultado | Evidencia |
|---|---|---|
| Aislamiento | Pasa | Organización heredada, RLS y pgTAP. |
| Especificación | Pasa | Spec, investigación, modelo, contrato y tareas antes de código. |
| Idempotencia/auditoría | Pasa | Unicidad, reclamo vencible, intentos y transiciones. |
| Despliegues independientes | Pasa | Reutiliza Supabase/Kestra sin Compose raíz. |
| Simplicidad operativa | Pasa | Rechaza trigger HTTP, Redis y cola externa. |

## Estructura

```text
supabase/migrations/<timestamp>_outbox_ejecuciones.sql
supabase/tests/database/outbox_ejecuciones.test.sql
infra/kestra/flows/plantilla-*.yml
workers/README.md
docs/adoptar-ciclo-ejecuciones.md
specs/019-outbox-ejecuciones/{research,data-model,quickstart}.md
specs/019-outbox-ejecuciones/contracts/despacho-outbox.md
```

No hay violaciones constitucionales ni complejidad adicional justificada.
