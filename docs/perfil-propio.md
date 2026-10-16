# Perfil propio y cambio de contraseña (F-PRF-01)

Spec: `specs/20261016-130000-perfil-y-permisos-avanzados/` (US1, FR-001…FR-004).

- **Perfil** (`/cuenta/perfil`): nombre, apellido y foto se guardan en `perfiles_usuario` solo para la sesión titular; el formulario refleja los valores recortados tras guardar.
- **Cambio de contraseña** (`/cuenta/cambiar-contrasena`): exige la contraseña actual. Vacía se rechaza en el cliente sin llamar a Auth; incorrecta se rechaza al verificarla contra Supabase Auth y antes de `updateUser`. Solo tras éxito se cierran las otras sesiones.
- **Regla de contraseña**: ≥ 12 caracteres con mayúscula, minúscula, número y símbolo, centralizada en `apps/web/src/lib/passwordPolicy.ts` (`passwordRules` + `passwordPolicyDescription`). **A confirmar con el cliente**: ajustarla se hace solo ahí.
- Sin cambios de base de datos ni de contrato; solo textos (tildes) y tests Vitest.
