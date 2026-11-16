# Notas · MSF-195 Ventas cobros y conciliación

- Base: `a2b439e7` (= `origin/dokploy` al arrancar; `dokploy` ya avanzó, sin impacto en esta spec). Alineada con la spec de MSF-177 en `087da767`: `cambiar_estado_comprobante` rechaza Cobrado/Deuda y `private.marcar_estado_cobro_comprobante(id, estado)` es el punto de entrada.
- **Discrepancia**: la épica dice que `comprobantes.guia` existe; no está en el repo ni en MSF-159/177. La guía vive en `contrarreembolsos.guia`.
- **Prototipo**: `VentasPagos`, `VentasTransportes`, `CuentasCobro` con inventarios al día. El diálogo «Registrar cobro» no está en el prototipo (se arma con el kit y se anota en el PR). Se dejan FUERA: Exportar, Motos, Faltantes, RMA, el diálogo de transportes y las cuentas de cobro (MSF-139).
- Horas: 24 h de la épica vs. estimaciones sueltas del roadmap (manda el roadmap).
- Decisiones abiertas provisorias en `spec.md`: roles (1), guía (2), Cobrado/Deuda (3), diálogo de cobro (4), qué pagos se concilian (5), fecha (6).
