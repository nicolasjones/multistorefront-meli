---
name: refine-frontend
description: Diseña, revisa o modifica pantallas y recursos de Refine en esta plataforma. Úsala para rutas, proveedores, recursos, autenticación, CRUD o Compose de Refine; no para una librería React aislada sin integración con la aplicación.
---

# Refine frontend

Mantén el frontend en `apps/web`; Refine opera con la clave pública de Supabase y las políticas RLS, nunca con service role ni secretos.

- Parte de la spec aplicable y declara alcance `refine`. Para una operación sobre datos, confirma el contrato de Supabase y sus permisos antes de modelar la pantalla.
- Conserva rutas protegidas, estados de carga/error y el aislamiento que entrega RLS. No dupliques en el navegador decisiones de autorización que pertenecen a Supabase.
- Ejecuta Refine en Docker con `pnpm dev:refine` o fuera de Docker con `pnpm dev:refine:host`; no agregues un Compose raíz. Respeta `WEB_PORT` y demás variables configurables.
- Para componentes Material UI, carga `mui-refine`. Para diseño, accesibilidad y rendimiento, carga solo la skill complementaria que corresponda (`frontend-design`, `web-design-guidelines`, `accessibility-*` o `vercel-react-best-practices`).
- Valida en proporción al cambio con `pnpm lint`, tests web y `pnpm build`; usa `pnpm infra:config:refine` si tocaste Compose o variables de infraestructura.
