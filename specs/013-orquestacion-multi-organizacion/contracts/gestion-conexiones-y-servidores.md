# Contrato: Gestión de conexiones y servidores de organización

Interfaz que Refine (y cualquier otro consumidor autenticado) usa contra
Supabase/PostgREST para administrar servidores y conexiones. Todo pasa por
RLS + las funciones `SECURITY DEFINER` de `data-model.md` — nunca por
lectura directa de una columna `*_vault_id` ni de `vault.decrypted_secrets`.

## Servidores de organización

1. **Alta de un servidor nuevo** — `private.aprovisionar_servidor_organizacion(organizacion_id, host, puerto, usuario, credencial_ssh)`
   - **Quién**: superadmin únicamente (US5).
   - **Qué hace**: crea el rol `worker_<organizacion_id>` en Postgres, genera su credencial, guarda la credencial SSH y la de base en Vault, inserta la fila en `servidores_organizacion`.
   - **Devuelve**: la credencial del rol de base **una sola vez**, en la respuesta de esta llamada — no queda recuperable en texto plano después (mismo patrón que cualquier secret manager: se copia en el momento). `quickstart.md` documenta este paso.
   - **Falla si**: la organización ya tiene un servidor (`servidores_organizacion.organizacion_id` es `unique`) — no hay "reemplazar servidor" en esta spec, es alta única (fuera de alcance: rotar servidor de una organización existente).

2. **Ver servidor de una organización** — `select` sobre `servidores_organizacion` (columnas no-secretas: `host`, `puerto_ssh`, `usuario_ssh`, `created_at`).
   - **Quién**: superadmin, o administrador de esa organización (FR-009 aplica por analogía: gestión de infraestructura de conexión, mismo nivel de permiso).

## Conexiones

3. **Crear una conexión** — `private.crear_conexion(organizacion_id, sistema_externo, credencial)` (nunca un `insert` directo del cliente): guarda `credencial` en Vault y crea la fila con `estado = 'activa'`.
   - **Quién**: administrador de esa organización o superadmin (FR-009).
   - **Pregunta 11 del contrato de la spec 012 aplica igual acá**: la organización dueña de cada fila que un worker escribe es la de la conexión/credencial usada en esa ejecución — el worker la propaga, no la infiere.

4. **Ver una conexión** — `select` sobre `conexiones` (columnas `sistema_externo`, `estado`, `created_at` — nunca `credencial_vault_id` descifrado, eso es la función 5). **Editar la credencial** — `private.actualizar_credencial_conexion(conexion_id, nueva_credencial)`, rota el secreto sin cambiar el resto de la fila.
   - **Quién**: administrador de esa organización o superadmin (FR-009). Un miembro sin ese rol: denegado tanto en la interfaz como en RLS (US3 AC3).

5. **Usar la credencial de una conexión para ejecutar** — `private.obtener_credencial_conexion(conexion_id)`.
   - **Quién**: administrador de esa organización, superadmin, o el rol `kestra_orquestacion` (R4).
   - **Nunca**: lectura directa de `vault.decrypted_secrets` — `revoke`d de `authenticated` y de `kestra_orquestacion`.

6. **Estado de una conexión** — columna `conexiones.estado`, de solo-lectura para la UI (la escriben únicamente `private.marcar_conexion_activa`/`private.marcar_conexion_credencial_invalida`, llamadas por Kestra).
   - **Transición automática**: `credencial_invalida → activa` ocurre sola en la próxima ejecución exitosa (FR-013) — no hay una acción de "reintentar" ni "marcar como resuelta" en esta interfaz.

7. **Leer los datos ya importados por una conexión** — fuera de esta interfaz: vive en las tablas de dominio (esquema `dominio`) de cada implementación futura, abierta a cualquier miembro de la organización sin el rol de administrador (FR-010). Esta spec no crea esas tablas.

## Fuera del contrato (a propósito)

- Rotar la credencial SSH o de base de un servidor ya aprovisionado — la spec solo cubre el alta (US5); una rotación es un caso de uso futuro.
- Cualquier endpoint público (sin sesión de Supabase Auth) — todo lo de arriba requiere autenticación, igual que el resto del template.
