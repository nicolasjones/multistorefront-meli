---
name: arquitectura-plataforma
description: Revisa o diseña cambios transversales de arquitectura para esta plataforma multi-tenant. Úsala ante cambios que crucen frontend, Supabase, Kestra, Superset, workers o sus despliegues; no para una edición local de un componente.
---

# Arquitectura de plataforma

Antes de proponer un cambio, lee `.specify/memory/constitution.md`, `docs/architecture.md` y la spec en alcance. No conviertas una mejora técnica en una funcionalidad de negocio sin su spec.

Conserva estas fronteras: el navegador usa únicamente permisos RLS y claves públicas; Supabase concentra datos, Auth y Storage; Kestra coordina pero no sustituye workers; los workers son procesos aislados; Superset es solo lectura analítica. No agregues un Compose raíz ni acoples los ciclos de despliegue.

Evalúa cada alternativa contra aislamiento por organización, idempotencia y auditoría, operación local reproducible, reversibilidad de migraciones y el alcance declarado (`refine`, `supabase`, `kestra`, `superset`, `workers`). Señala contratos, permisos, errores y evidencia de validación que cambiarían. Prefiere extensiones aditivas y capacidades reutilizables sobre integrar una solución específica de un producto en la plantilla.

Al cerrar, entrega la decisión, límites, archivos afectados y riesgos o dependencias que aún deban validarse.
