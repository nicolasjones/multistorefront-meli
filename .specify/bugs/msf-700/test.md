# Test MSF-700

- `lib/destinoIngreso.test.ts`: acepta rutas internas; rechaza vacío, `//host`, `/\host`, `https:`, `javascript:`, control, `/login`.
- `providers/authProvider.test.ts`: login con `to` interno vuelve ahí; `to` externo cae en `/`.
- Alcance E2E: no aplica (sin criterio de pantalla nuevo).
