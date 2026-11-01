# Contactos: libreta por empresa (MSF-144 · F-CON-05)

La libreta guarda a quienes consultan o compran, sin duplicados, con el consentimiento registrado, su historial de
consultas y compras, y permite anonimizarlos a pedido. Spec:
[`specs/20261029-120000-contactos-y-respuestas-rapidas`](../specs/20261029-120000-contactos-y-respuestas-rapidas/spec.md)
(contrato en `contracts/contactos.md`). Las respuestas rápidas (F-CON-06) tienen su propia historia.

## Modelo (Principio VII)

| Objeto | Esquema | Para qué |
|---|---|---|
| `dominio.contactos` | `dominio` | Persona de una **empresa** (datos personales + consentimiento). Entidad de negocio. |
| `dominio.consultas.contacto_id`, `dominio.comprobantes_venta.contacto_id` | `dominio` | Vínculo opcional (columnas aditivas, FK compuesta por organización). |
| `public.crear_contacto`, `actualizar_contacto`, `vincular_consulta_contacto`, `vincular_comprobante_contacto`, `anonimizar_contacto`, `buscar_contactos`, `historial_contacto` | `public` | Superficie de ejecución y lectura; no guardan datos. Ninguna para `anon`. |
| `public.consultas_bandeja` | `public` | Suma `contacto_id` al final (aditivo). |

La app **no escribe** en `dominio.contactos`: solo las RPC `security definer`. RLS por organización, empresa accesible y
sección `consultas` (`lectura` ve, `edicion` escribe, `ninguno` no ve).

## Reglas

- **Duplicados**: por empresa, el correo (minúsculas, sin espacios) y el teléfono (solo dígitos) son únicos entre contactos
  no anonimizados. El intento duplicado devuelve `23505` con el id del existente y la pantalla ofrece vincular la consulta a él.
- **Consentimiento**: obligatorio al crear; se guarda fecha, quién lo registró y una **copia** del texto vigente
  (`apps/web/src/lib/consentimientoContacto.ts`, «pendiente de aprobar» por el cliente: Decisión abierta 1).
- **Edición**: bloqueo optimista por `updated_at` (`40001`).
- **Anonimizar** (irreversible): nombre, correo y teléfono del contacto y nombre, contacto y mensaje de sus consultas
  vinculadas pasan a texto neutro; se libera la clave de duplicado. No se borran filas ni se tocan las ventas. La nota
  interna de la consulta **no** se modifica (la spec no la incluye). No hay expiración automática por plazo.
- **Actividad**: cada acción deja un evento en `registro_actividad` sin nombre, correo ni teléfono.
- **Empresa activa** (Principio VIII): libreta, ficha y diálogos recargan al cambiar de empresa; los diálogos se cierran con aviso
  y la ficha vuelve a la libreta.

## Pantallas

`/contactos` (grupo Canales, debajo de Consultas), `/contactos/:id` (ficha, carga diferida), `Crear contacto` en el detalle de
la consulta y `Nuevo contacto` (con una tienda elegida) en la libreta. Sin prototipo dibujado: patrones compartidos del panel.

## Reversión

Migraciones `20270201100000…100500`, todas aditivas. Se revierten con `drop function` / `drop table dominio.contactos` /
quitar las columnas `contacto_id` y restaurar la vista (ver el encabezado de cada una). Exportar antes los datos personales.
Los datos **ya anonimizados** solo se recuperan desde un backup.
