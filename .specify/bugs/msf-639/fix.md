# Fix MSF-639 — Avisos de acceso inconsistentes

- **Slug**: msf-639
- **Assessment**: ./assessment.md
- **Status**: applied

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

## Segunda devolución (PR #620, 2026-11-01)

El Revisor volvió a revisar la historia y la aprobó (técnica y seguridad) sin hallazgos accionables: los dos apuntes
que dejó («Rentabilidad, Listas y Motivos ya usaban este patrón» y «el guardado no cambió») son de alcance de
pruebas, no cambios pedidos. Lo que faltaba era el resto del contrato de la historia:

- **Artefacto de Spec Kit que faltaba**: se agrega `.specify/bugs/msf-639/assessment.md` (síntoma, reproducción,
  código implicado, remediación propuesta, riesgos). Los comandos `speckit.bug.fix` y `speckit.bug.test` lo
  exigen como contrato previo, y todas las historias de la familia lo tienen (por ejemplo `.specify/bugs/msf-697/`).
- **Evidencia E2E de los dos escenarios que pide la revisión de seguridad**: `apps/web/e2e/avisos-acceso.e2e.ts`
  (rótulo `[MSF-639:AVISOS]` en el título, con el fixture de evidencia para el video a 1920×1080). Siembra una
  organización con una tienda y dos personas (Administrador y Operador) y comprueba, con el Operador, que `/empresas`
  y `/organizacion` muestran «No tenés acceso a esta sección» sin ningún aviso de tono error, que en el detalle de la
  empresa «Solo lectura» es un aviso informativo (`role="note"`) y no un error rojo, y que con el Administrador no
  aparece ninguno de los dos avisos.
- **Asserts que fijan la regresión**: en `/empresas` y `/organizacion` se verifica además que no aparezca el aviso viejo
  «Acceso restringido» ni ninguna alerta de tono error (`MuiAlert-standardError`), no solo que aparezca el patrón nuevo.
- **Documentación**: `docs/empresas.md` describe los dos avisos (pantalla común de acceso restringido en `/empresas` y
  `/organizacion`, aviso informativo de «Solo lectura» en el detalle) y `docs/e2e-app.md` registra el E2E nuevo.

No cambia el comportamiento de la corrección aprobada: el diff de código de esta devolución es solo de pruebas y
documentación.
