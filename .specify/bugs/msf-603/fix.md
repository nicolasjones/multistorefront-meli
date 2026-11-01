# Fix MSF-603 — tildes, eñes y voseo (BUG-321)

Solo texto, sin lógica. Cambios en `apps/web/src`:

- Cambiar contraseña / Cambiar correo (`pages/cuenta`): «Contraseña actual», «Nueva contraseña», «Correo electrónico», «confirmación»; avisos en voseo (Ingresá, Elegí, Intentá, Podés).
- Política de contraseña (`lib/passwordPolicy.ts`): contraseña, mayúscula, minúscula, número, símbolo.
- Recuperar acceso (`pages/acceso/solicitar-recuperacion.tsx`): «Enviar enlace de recuperación», «El enlace venció o ya se usó. Solicitá uno nuevo…».
- Invitación (`pages/acceso/definir-contrasena.tsx`): «Pedile a un Administrador», «Intentá…».
- Actividad (`lib/actividad.ts`): etiquetas explícitas «Comprobante nota crédito emitida», «RMA nota crédito vinculada», «Reparación editada» y tildes en el texto de reserva (reparación, crédito, RMA).

Fuera de alcance: `perfil.tsx` y `lib/invitaciones.ts` (no figuran en el pedido).
