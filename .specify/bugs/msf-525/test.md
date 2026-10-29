# Verificación: MSF-525

- `pnpm test:edge:enviar-correo-proveedor`: 10/10 (destinatario fijo, sin sesión, sin edición, otra organización, sin correo, validaciones, fallo SMTP).
- Vitest `src/components/proveedores src/pages/proveedores`: 47/47 (incluye `EnviarCorreoProveedorDialog.test.tsx`).
- `pnpm lint` sin errores (solo warnings previos), `pnpm build` OK, `pnpm docs:check` OK.
- Pendiente de CI/entorno: envío real contra SMTP (Mailpit) y E2E.
