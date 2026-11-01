# Fix MSF-639 — Avisos de acceso inconsistentes

- `/empresas` (`pages/empresas/list.tsx`) y `/organizacion` (`pages/organizacion/edit.tsx`): sin permiso de escritura mostraban un `EstadoError` rojo «Acceso restringido». Ahora renderizan `AccesoRestringido` («No tenés acceso a esta sección»), el patrón de Rentabilidad, Listas y Motivos.
- `/empresas/:id` (`pages/empresas/edit.tsx`): «Solo lectura» era un `EstadoError` rojo. Ahora es un `Alert severity="info" role="note"` — el aviso informativo del prototipo (`design/pantallas/Historial.dc.html`, clase `al i` con `role="note"`) y el mismo criterio que `components/consultas/DetalleConsulta.tsx`. El rótulo «Solo lectura» del Historial es además una `EtiquetaEstado` (chip neutro), no un error. El formulario sigue deshabilitado.
- No se tocan permisos, RLS ni migraciones; solo cambia la presentación del aviso.

## Devolución del Revisor (PR #620)

- Veredictos: QA, revisión técnica y security review **APPROVED** sobre `155fd2e4` (mismo SHA aprobado en el PR #590, que quedó cerrado sin mergear). Sin hallazgos accionables: los dos apuntes del revisor fueron «no hace falta probar» (Rentabilidad/Listas/Motivos ya usaban el patrón; el guardado no cambió).
- La rama se actualizó contra `dokploy` (`f53106bf`, sin conflictos) antes de mergear.
- Ajustes de esta devolución, todos acotados a la historia:
  - Los asserts ahora fijan el **patrón** completo, no solo una cadena: encabezado de nivel 1 «No tenés acceso a esta sección» y el motivo «Tu rol (actual) no incluye …» en `/empresas` y `/organizacion`.
  - El aviso «Solo lectura» evita la repetición de «solo» del texto anterior: «Solo lectura: únicamente los administradores pueden editar los datos de la empresa.»
  - `fix.md`/`test.md` corregidos: el aviso informativo de las empresas toma el patrón `al i`/`role="note"` del prototipo, no el chip «Solo lectura» del Historial.
