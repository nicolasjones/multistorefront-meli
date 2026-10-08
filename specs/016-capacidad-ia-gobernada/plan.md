# Implementation Plan: Capacidad de IA gobernada

**Branch**: `016-capacidad-ia-gobernada` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

## Summary

Núcleo TypeScript común para consumidores de IA: valida contrato y política, sanitiza datos, obtiene configuración segura, invoca un adaptador de proveedor y registra el resultado. Supabase conserva configuración, políticas globales, interacciones y evidencia sanitizada; Vault conserva claves; Refine administra el catálogo cerrado y Kestra sólo recibe eventos sanitizados.

## Technical Context

**Language/Version**: TypeScript/Node.js, React/Refine, SQL PostgreSQL/Supabase, YAML Kestra 1.3.35.

**Dependencies**: Playwright, Supabase Vault/RLS, workers Node, Kestra OSS y adaptadores de proveedor.

**Storage**: configuración, políticas e interacciones globales; Vault para claves; Storage privado para evidencia efímera.

**Testing**: Vitest de contrato, sanitizador y adaptadores fixture; pgTAP de RLS/RPC/estados/purga; consumidor fixture; pruebas de eventos Kestra; `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test`.

**Constraints**: catálogo inicial OpenAI, Anthropic/Claude, Google/Gemini, xAI/Grok, DeepSeek, Alibaba/Qwen, Zhipu/GLM, Moonshot/Kimi y Baidu/ERNIE. Modelos descubiertos por clave; fallback sólo ante fallo técnico previo a respuesta válida; máximo dos intentos y 90 segundos. Sólo superadmin resuelve revisiones. Sin secretos ni datos excluidos por el contrato.

## Constitution Check

| Gate | Resultado | Diseño |
|---|---|---|
| I. Aislamiento multi-tenant | Pasa condicionado | RLS/RPC de mínimo privilegio y Vault sólo por runtime autorizado; pgTAP prueba que administradores de organización no ven datos de IA. |
| II. Especificar antes de implementar | Pasa | Artefactos trazan FR-001–FR-013. |
| III. Idempotencia y auditoría | Pasa condicionado | Estados, claves únicas, verificador y eventos append-only. |
| IV. Despliegues independientes | Pasa | Refine, Supabase, workers y Kestra separados; sin Compose raíz. |
| V. Simplicidad operativa | Pasa | Biblioteca/adaptadores, no agente autónomo ni infraestructura nueva. |
| Quality Gates | Pasa condicionado | Migración aditiva, RLS, purga y validación completa. |

## Project Structure

```text
apps/web/src/pages/ia/
packages/ia/
supabase/{migrations,tests/database}/
infra/kestra/flows/
specs/016-capacidad-ia-gobernada/{research,data-model,quickstart,contracts}/
```

**Structure Decision**: `packages/ia` es una biblioteca interna compartida; cada consumidor vive en su producto o worker Docker de dominio y define su contrato en una spec propia. No existe worker ni adaptador de navegación en esta entrega.

## Design Deliverables

- [research.md](./research.md)
- [data-model.md](./data-model.md)
- [contrato del núcleo](./contracts/nucleo-ia.md)
- [quickstart.md](./quickstart.md)

## Complexity Tracking

No aplica.
