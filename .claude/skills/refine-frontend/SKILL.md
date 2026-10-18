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

## En esta plataforma: el prototipo manda la UI

El diseño *nuevo* es la excepción: acá la fuente de verdad visual es `design/pantallas/*.dc.html`. Al construir o rehacer una pantalla, el prototipo gana sobre cualquier dirección estética propia: corré `pnpm prototipo:inventario`, implementá con los tokens/tema (`apps/web/src/tema`) y no con valores sueltos, y mapeá lo visible a `## Matriz pantalla↔criterios` en el `spec.md`. El CI lo exige con `pnpm prototipo:check` (inventario al día) y `pnpm matriz:check` (spec con UI sin matriz = inválida). Para la comparación lado a lado: `pnpm --filter @platform/web pantallas:capturar`. Ver `docs/prototipos.md`.
