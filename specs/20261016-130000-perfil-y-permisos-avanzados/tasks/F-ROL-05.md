# Marcas de F-ROL-05 (reconciliado, FEAT-117/BUG-137)

Las tareas de **esta** historia quedaron hechas (la historia está **Finalizada**). Se reconcilia por si el Revisor no las marcó.

- [x] T005
- [x] T006
- [x] T007
- [x] T008
- [x] T009
- [x] T010
- [x] T011
- [x] T012
- [x] T013 — Desvío: la corrida real contra el SMTP del servidor self-hosted **no se ejecutó** (el VPS no tiene relay SMTP real ni SPF/DKIM, así que el aviso no sale). El guion quedó endurecido para que no pueda dar un verde falso y la corrida quedó registrada en «pendiente» con su dueño y su protocolo: `docs/verificacion-salida-correo.md`. Seguimiento: **MSF-532** (Tarea `seguimiento` «Ejecutar la verificación de salida del correo contra el SMTP real del servidor self-hosted (FR-012b)», dueño: infraestructura/Nicolás). Ver commit 043be599.
- [x] T014
