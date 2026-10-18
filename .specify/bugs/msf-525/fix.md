# Fix: «Enviar correo a proveedor» (MSF-525)

- **Origen**: assessment.md (T029/FR-020 de `20261018-190000-proveedores-y-productos`, decisión de negocio: entregar la acción del prototipo).
- **Decisiones sobre las preguntas abiertas**: botón en ficha **y** listado (como el prototipo); `Para` solo lectura = `proveedores.correo` (no relay); sin historial, remitente `SMTP_FROM` genérico y sin límite de frecuencia (a consultar).
- **Cambios**: `supabase/functions/enviar-correo-proveedor/{handler,index,handler.test}.ts` (JWT + nivel `edicion` vía `permisos_actuales()` + lectura RLS del proveedor; sin service-role); `apps/web/src/lib/proveedores.ts` (`enviarCorreoProveedor`); `EnviarCorreoProveedorDialog.tsx` (+ test); botones en `pages/proveedores/{show,list}.tsx`; script `test:edge:enviar-correo-proveedor`; `docs/proveedores.md`.
- **Base de datos**: sin migraciones.
