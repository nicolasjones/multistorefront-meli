# Checklist: Kit de panel operable

- [X] Cada destino de navegación declara audiencia explícita (FR-001).
- [X] El sider oculta destinos no autorizados en vez de deshabilitarlos
      visualmente (FR-002).
- [X] El contexto de panel no acepta un `user_id` arbitrario (FR-003).
- [X] Ninguna superficie de este kit imprime un UUID como texto visible
      principal (FR-004, FR-005).
- [X] El identificador técnico solo es copiable por superadmin (FR-006).
- [X] Toda pantalla que consuma `EstadosPagina` comunica carga, vacío, error
      y éxito (FR-007).
- [X] `ContenidoAdaptable` comparte columnas y acciones entre tabla y
      tarjeta (FR-009).
- [X] El menú de cuenta vive separado del sider de navegación (FR-011).
- [X] Ninguna URL existente del template cambió como parte de este PR.
- [X] La migración es aditiva; no elimina función, tabla ni policy.
