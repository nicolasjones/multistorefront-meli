# Fix MSF-700

- `apps/web/src/main.tsx`: el vencimiento por inactividad en host de tienda cierra con `salirCliente()` (scope local) y no con `authProvider.logout` (signOut global); el cierre del panel no cambia.
- `apps/web/src/lib/destinoIngreso.ts`: `destinoInternoSeguro` acepta solo rutas relativas internas (sin `//`, esquema ni `\`, ni `/login`).
- `authProvider.login` devuelve `redirectTo` = `to` validado o `/`; `LoginPage` pasa `?to=` (el que arma `CatchAllNavigate`).
- Sin cambios de BD. Reversión: revert del commit.
