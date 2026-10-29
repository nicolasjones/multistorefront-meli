# Plan: reencuadre al cambiar de empresa

1. **Aviso único**: `lib/cambioEmpresaActiva.ts` con versión + suscriptores
   (`useSyncExternalStore`). El selector lo dispara sólo si la RPC tuvo éxito.
2. **Invalidar todo**: `useInvalidate({ invalidates: ['all'] })` sin `resource`
   (además del `access` que ya se invalidaba).
3. **Remontar el contenido**: `ContenidoPorEmpresa` envuelve el `<Outlet />` con
   `key={version}`; el encabezado y el selector quedan montados.
4. **Sin recarga**: no se usa `location.reload()`; la ruta se conserva.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `lib/cambioEmpresaActiva.ts` | Versión + suscriptores |
| `hooks/useVersionEmpresaActiva.ts` | Hook `useSyncExternalStore` |
| `hooks/useEmpresaActiva.ts` | Invalida datos y avisa el cambio |
| `components/pagina/ContenidoPorEmpresa.tsx` | Remonta el `<Outlet />` |
| `App.tsx` | Envuelve el contenido ruteado |

## Verificación

- Tests: store, remonte y aviso del selector (4 nuevos).
- `pnpm lint`, `build`, `test:web`, `docs:check`, `matriz:check`.
