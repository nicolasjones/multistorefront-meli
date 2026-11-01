# Fix: msf-696

- **Assessment**: assessment.md (remediación preferida)
- **Cambios**:
  - `apps/web/src/lib/whatsapp.ts`: `normalizarNumero` lleva el número a formato internacional (`+`/`00` se respetan; `54` sin 9 → `549`; local AR: quita `0` troncal y `15`, antepone `549`; ambiguo → `null`).
  - `apps/web/src/lib/responderConsulta.ts`: `enlaceRespuesta` reusa `urlWhatsapp` (una sola normalización).
  - `BotonWhatsApp.tsx`: arma la URL con el número original, no con dígitos ya normalizados (evita normalizar dos veces).
  - Docs: `docs/tienda-contacto.md`, `docs/consultas.md`.
- **Fuera de alcance (seguimiento)**: validación/aviso de formato en el campo WhatsApp de la empresa y en el formulario público (cambia reglas de aceptación y pantallas con prototipo); asume AR como país por defecto.
