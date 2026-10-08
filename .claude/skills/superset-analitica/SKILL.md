---
name: superset-analitica
description: Diseña, revisa o modifica analítica embebida de Apache Superset en esta plataforma. Úsala para dashboards, guest tokens, vistas de lectura, permisos o Compose de Superset; no para operaciones transaccionales de la aplicación.
---

# Superset y analítica embebida

Superset es exclusivamente una capa de lectura analítica; Refine y Supabase conservan las operaciones transaccionales y los límites de autorización.

- Parte de la spec aplicable y declara alcance `superset`; cualquier cambio de datos o permisos de Supabase se diseña y valida también con sus contratos y RLS.
- Los dashboards se exportan a YAML y se versionan: nunca dejes una entrega solo en la UI de Superset. Las vistas o datasets deben minimizar datos y respetar el aislamiento por organización.
- El navegador no recibe credenciales administrativas. Para embebido usa la cuenta de servicio y el mecanismo de guest token ya configurados; no reutilices la cuenta admin interactiva.
- Mantén `infra/superset/compose.yaml` separado y los secretos solo en variables de entorno locales o del entorno de despliegue. No expongas Superset sin la protección prevista por el reverse proxy en producción.
- Valida la configuración con `pnpm infra:config:superset`; si el cambio incluye embebido, verifica también el contrato de acceso desde Refine sin registrar tokens.
