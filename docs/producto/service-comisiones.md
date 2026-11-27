---
owner: producto
sources:
  - apps/web/src/pages/service-tecnico/comisiones.tsx
  - apps/web/src/components/service/RepartoComision.tsx
  - apps/web/src/pages/roles/list.tsx
  - supabase/migrations/20270515020000_comisiones_rpc.sql
---

# Service técnico: comisiones de los técnicos

Esta página explica cómo ver y repartir las **comisiones** de los técnicos por la mano de obra de las reparaciones entregadas.
Es una **estimación para liquidar**: el sistema no registra pagos.

> **Capturas pendientes.** Esta pantalla todavía no tiene capturas en este manual. Se agregan cuando se generen con el
> juego de datos de demostración.

## Cómo se calcula

La comisión de una reparación es la **mano de obra que se le cobró al cliente (sin IVA)** por el porcentaje de la **regla de
comisión** del técnico, y por la parte que le toca si la comisión se reparte entre varios. Los repuestos y los costos internos no cuentan.
La regla que rige es la que estaba vigente el día de la **entrega**.

## Mis comisiones

En **Servicio técnico → Comisiones** todas las personas con acceso a Servicio técnico ven **Mis comisiones**:

1. Elegí el mes (la pantalla muestra un mes calendario por vez).
2. Mirá tu comisión del mes y la cantidad de reparaciones entregadas.
3. Abajo está el detalle por reparación: mano de obra, tu parte, la regla y tu comisión.

Solo ves lo tuyo, sin costos ni márgenes. Si una reparación figura **«Sin regla»**, no había una regla de comisión vigente a la
fecha de entrega y su comisión es $ 0: consultá con el taller.

## Equipo y reglas (permiso «Ver comisiones»)

Con el permiso **Ver comisiones** aparecen las pestañas **Equipo** (todos los técnicos del mes y su detalle) y **Reglas**.
Ese permiso es independiente de **Ver costos**: tener uno no da el otro. Se configura en **Usuarios y permisos → Roles → Acciones
sensibles → Ver comisiones**.

En **Reglas** se carga un porcentaje por técnico o para todos, **desde mañana como pronto** (no cambia lo ya entregado). Las reglas **solo se agregan**: para dejar de
pagar comisión se carga una regla de 0 %. La regla del técnico gana a la general. Cargar reglas además exige permiso de edición en Servicio técnico.

## Repartir la comisión entre varios técnicos

En el detalle de una reparación, la sección **Comisión de técnicos** muestra cómo se reparte. Por defecto es 100 % para el técnico asignado.

1. Tocá **Repartir comisión**.
2. Elegí los técnicos y el porcentaje de cada uno. **Tienen que sumar 100 %** (hasta 10 técnicos, dos decimales).
3. Guardá. «Volver al reparto por defecto» vuelve al 100 % del técnico asignado (solo antes de la entrega).

Al **entregar** la reparación el reparto queda **congelado**: cambiar después el técnico asignado no mueve la comisión. Cambiar el
reparto de una reparación ya entregada exige el permiso **Ver comisiones** y un **motivo**, y queda registrado (el historial lo ve quien tiene ese permiso).
