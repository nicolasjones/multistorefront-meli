# Research: Gestión de miembros de organización

## Decisión: Edge Function para incorporar e invitar miembros

**Rationale**: La invitación de una cuenta nueva necesita `auth.admin.inviteUserByEmail`, que exige la service-role key. El precedente `crear-organizacion` ya usa una Edge Function para mantener esa clave fuera del navegador. La nueva función valida el JWT del actor antes de usar un cliente con privilegios y opera solo sobre su organización administrable.

**Alternatives considered**:

- RPC desde el navegador: descartada; no puede usar Auth Admin sin exponer la service-role key.
- Invitar desde el cliente Supabase: descartada; el navegador no debe tener privilegios administrativos.
- Reutilizar `crear-organizacion`: descartada; su contrato crea una organización y solo autoriza superadmins.

## Decisión: Cuenta nueva invitada; cuenta existente sin membresía vinculada directamente

**Rationale**: `inviteUserByEmail` rechaza cuentas existentes. Para que una persona removida pueda incorporarse a otra organización —regla explícita de la spec—, la función primero busca mediante la API administrativa de Auth si ya existe una cuenta. Si existe y no tiene membresía, registra la membresía sin reenviar correo; ya puede acceder con sus credenciales. Si no existe, envía la invitación y luego registra la membresía con el rol elegido. No se expone una función `security definer` en `public` para buscar en `auth.users`.

**Alternatives considered**:

- Rechazar toda cuenta existente: descartada; impediría mover a una persona entre organizaciones.
- Agregar un proveedor de correo transaccional: descartada; no hay caso de negocio para una infraestructura adicional solo para notificar una cuenta ya existente.
- Crear una tabla de invitaciones pendientes: descartada en esta entrega; Auth ya crea el usuario invitado y la membresía reservada no concede sesión antes de completar el acceso. No hay cancelación, reenvío ni historial de invitaciones en alcance.

## Decisión: Operaciones de rol/remoción con RPCs `security definer`

**Rationale**: `usuarios_organizacion` no debe recibir grants de escritura para `authenticated`. Las RPCs validan autorización y organización objetivo, bloquean la organización para serializar la regla de último administrador, modifican una fila y agregan el evento de auditoría en la misma transacción.

**Alternatives considered**:

- Insert/update/delete directos con RLS: descartados; es más fácil introducir una escalada de privilegios o una carrera que deje a una organización sin administrador.
- Edge Function para todas las mutaciones: descartada; los cambios de rol y remoción no requieren secretos y una RPC transaccional conserva mejor atomicidad con la auditoría.

## Decisión: Helper específico para gestionar membresías

**Rationale**: `private.puede_escribir()` expresa permisos de datos de negocio y no recibe organización como argumento. Se agrega un helper privado parametrizado que permite gestionar solo si el actor es administrador de esa organización o superadmin con exactamente esa organización activa. Así un superadmin sin contexto, o en otro contexto, no lista ni modifica miembros ajenos.

**Alternatives considered**:

- Reutilizar sin cambios `private.puede_escribir()`: descartado; no relaciona el permiso con la fila de membresía objetivo.
- Mantener la policy actual que permite a un superadmin ver todas las membresías: descartado; contradice el contexto activo y el aislamiento de la spec 005.

## Decisión: Auditoría append-only independiente

**Rationale**: Una tabla de eventos de membresía separa los movimientos de personas de la auditoría de entrada/salida del superadmin. Registra actor, objetivo, organización, acción, roles anterior/nuevo y timestamp. No recibe escrituras directas ni requiere mostrarse aún en la UI.

**Alternatives considered**:

- Reutilizar `superadmin_entradas`: descartado; modela únicamente cambios de contexto del superadmin y no tiene los campos de miembro/rol.
- Registrar eventos solo en logs de la Edge Function: descartado; no sería una línea de tiempo transaccional ni verificable con pgTAP.

## Decisión: pgTAP para fronteras de seguridad y concurrencia

**Rationale**: La constitución exige pgTAP para aislamiento sensible. Se extiende la suite existente con lectura de membresías, intentos cruzados, miembro sin privilegios, superadmin sin/con contexto, último administrador y auditoría de operaciones efectivas.

**Alternatives considered**:

- Solo ocultar acciones en Refine: descartado; no protege llamadas directas.
- Solo prueba manual de Edge Function: descartado; no prueba las policies ni las RPCs bajo el rol `authenticated`.
