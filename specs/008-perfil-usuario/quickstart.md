# Quickstart: Validación de gestión del perfil personal

## Prerrequisitos

1. Desde la raíz, iniciar Supabase: \`pnpm dev:supabase\`.
2. Crear o usar dos organizaciones y miembros de prueba: dos usuarios en la organización A, uno en B y, opcionalmente, un superadmin con contexto A.
3. Iniciar la web fuera de Docker: \`pnpm dev:refine:host\`.
4. Abrir Mailpit local para inspeccionar confirmaciones y avisos de seguridad.

## Escenarios de validación

### 1. Perfil e identidad activa

1. Iniciar sesión con un integrante de A.
2. Confirmar que la pantalla general indica “Logueado como” y lleva al perfil.
3. Guardar nombre y apellido; recargar y confirmar persistencia.
4. Intentar guardar uno vacío y confirmar que no cambia el perfil.
5. Cerrar sesión y confirmar que la identidad anterior no queda visible.

### 2. Foto y aislamiento de organización

1. Cargar una imagen válida, comprobar la foto en el perfil y en la identidad de sesión; reemplazarla y luego quitarla.
2. Intentar cargar un tipo inválido o más de 2 MiB; confirmar que la foto anterior se conserva.
3. Con otro usuario de A, abrir el listado de miembros y comprobar que puede ver solo la foto; confirmar que no puede leer el perfil ajeno. Con uno de B, comprobar que no puede obtener la foto por la aplicación ni mediante Storage.
4. Ejecutar el test pgTAP de esta feature para validar el mismo aislamiento sin depender de la interfaz.

### 3. Correo y contraseña

1. Desde perfil, ingresar contraseña actual y una dirección nueva disponible.
2. Verificar que llega la confirmación solo a la dirección nueva y que el acceso continúa con la anterior antes de confirmar.
3. Abrir el enlace válido, comprobar el correo nuevo en perfil y el aviso de seguridad al correo anterior en Mailpit.
4. Intentar el flujo con contraseña incorrecta, correo duplicado y enlace vencido; confirmar que no hay cambio efectivo.
5. Abrir el cambio de contraseña desde perfil y repetir el escenario existente de \`specs/006-autogestion-contrasena/quickstart.md\`.

### 4. Últimas acciones de seguridad

1. Iniciar sesión, cambiar la contraseña y completar un cambio de correo.
2. Abrir el perfil: aparecen \`inicio_sesion\`, \`contrasena_modificada\` y \`correo_modificado\`, con tipo y momento, sin secretos.
3. Generar más de 20 eventos válidos y confirmar que la vista contiene solo los 20 más recientes por orden descendente.
4. Confirmar que no aparecen eventos de clientes, usuarios o membresías y que otra cuenta no puede leer los eventos del titular.

## Validación automatizada

Ejecutar desde la raíz:

\`\`\`text
pnpm lint
pnpm build
pnpm infra:config
pnpm test:web
pnpm test:db
\`\`\`

Se espera que Vitest cubra rutas, estados y mensajes del perfil, y que pgTAP demuestre RLS para perfiles, eventos y \`storage.objects\`, incluidos los intentos entre organizaciones. Consultar [data-model.md](./data-model.md) y el [contrato](./contracts/perfil-personal.md) para las reglas verificadas.

## Resultado de validacion - 2026-09-10

- T034: los formularios usan etiquetas visibles, mensajes con `Alert` y roles de estado, y los botones de cada operacion exponen su estado `aria-busy`. La carga y eliminacion de foto limpian el mensaje anterior antes de iniciar una nueva operacion.
- T036: `pnpm lint` paso con una advertencia existente de React sobre `setState` dentro de `useEffect`; `pnpm build`, `pnpm infra:config`, `pnpm test:web` (44 pruebas) y `pnpm test:db` (130 pruebas pgTAP) pasaron.
- Verificacion de navegador: una visita anonima a `/cuenta/perfil` redirige a `/login?to=%2Fcuenta%2Fperfil`; la pantalla de acceso se renderiza correctamente.
- T037, ejecutado con cuentas y organizaciones efimeras locales ya eliminadas: se inicio sesion, se guardaron nombre y apellido, se verificaron correo, fecha, organizacion y rol de solo lectura, se solicito un correo nuevo tras reautenticar, Mailpit recibio la confirmacion en el correo nuevo y el aviso en el anterior, se confirmo el enlace y el nuevo inicio de sesion funciono. La vista mostro eventos `inicio_sesion` y `correo_modificado`.
- El cambio de contrasena se repitio manualmente desde el enlace del perfil: se valido la contrasena actual, una nueva clave conforme a la politica y la sesion activa continuo en la pantalla principal. La carga, el reemplazo y la eliminacion de foto se verificaron con Playwright en el contenedor local: se inyecto un PNG en memoria en el selector, se confirmaron los tres mensajes de resultado y la comprobacion final en Supabase dejo la fila de perfil con `foto_path` nulo y sin objeto en Storage. Durante el recorrido se detecto y corrigio con una migracion aditiva el bloqueo de RLS que impedia crear un perfil con solo foto.
