# Fix MSF-639 — Avisos de acceso inconsistentes

- `/empresas` (`pages/empresas/list.tsx`) y `/organizacion` (`pages/organizacion/edit.tsx`): sin permiso de escritura mostraban un `EstadoError` rojo «Acceso restringido». Ahora renderizan `AccesoRestringido` («No tenés acceso a esta sección»), el patrón de Rentabilidad, Listas y Motivos.
- `/empresas/:id` (`pages/empresas/edit.tsx`): «Solo lectura» era un `EstadoError` rojo. Ahora es un `Alert severity="info" role="note"`, igual que el aviso de solo lectura del Historial (F-VTA-38). El formulario sigue deshabilitado.
- No se tocan permisos, RLS ni migraciones; solo cambia la presentación del aviso.
