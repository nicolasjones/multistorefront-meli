# Adoptar tooling Node/TypeScript en un producto derivado

La Spec 020 reemplaza tooling operativo propio por programas Node ESM. No crea
un backend de aplicación: Refine continúa usando Supabase directamente con RLS;
Kestra coordina y los workers ejecutan integraciones aisladas.

## Inventario del template

| Grupo | Relevo Node | Archivo anterior | Estado |
| --- | --- | --- | --- |
| Render/publicación Kestra | `pnpm kestra:render-flow`, `pnpm kestra:deploy-flow` | `infra/kestra/{renderizar-flow,desplegar-flow}.ps1` | Migrado y retirado |
| CI y VPS | `pnpm db:reset:ci`, `pnpm deploy:vps -- staging` | `scripts/{reset-db-ci,deploy-vps}.sh` | Migrado y retirado |
| IA, secretos y runtime | `pnpm test:ia:aprovisionamiento`, `pnpm test:kestra:secretos`, `pnpm test:kestra:runtime` | scripts PowerShell correspondientes | Migrado y retirado; E2E explícito: `pnpm test:kestra:secretos:e2e` |
| Runner autocontenido | `infra/runner/entrypoint.mjs` | `infra/runner/entrypoint.sh` | Migrado; Node ya está instalado en la imagen del runner |
| Fixtures internos Docker | — | `infra/kestra/fixtures/{worker,worker-runtime,ssh-host}/*.sh` | Excepción técnica explícita: son contratos de `ENTRYPOINT`, `/custom-cont-init.d` o `sh` de imágenes Docker efímeras. No son comandos públicos ni tooling operativo; sus Dockerfiles los invocan dentro de imágenes base que no requieren Node. |

Antes de ejecutar el E2E local de Kestra, reconciliar el rol JDBC con el
entorno local mediante `pnpm kestra:sincronizar-rol-local`. El comando exige
`KESTRA_ORQUESTACION_DB_PASSWORD`, la aplica por stdin a PostgreSQL y no la
imprime. El valor permanece exclusivamente en `infra/kestra/.env` ignorado.

## Adopción incremental

El publicador `pnpm kestra:deploy-flow` consulta primero el flow indicado: lo
crea si no existe y lo actualiza si existe. Las credenciales y las respuestas
de Kestra no se imprimen. `pnpm test:kestra:deploy-flow` prueba ambas rutas y
una respuesta de consulta rechazada sin requerir una instancia real.

1. Inventariar los scripts propios del producto y separarlos de los que una
   imagen Docker o herramienta de terceros exige internamente.
2. Traer el relevo Node, probarlo con datos locales sin secretos en argumentos,
   y actualizar `package.json`, CI y la guía operativa en el mismo commit.
3. Recién después retirar el archivo anterior. No borrar comandos específicos
   del producto si no hay un equivalente validado.
4. Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config` y los tests/flows
   afectados. Una validación de YAML no sustituye una ejecución real de Kestra.

Los tres fixtures exceptuados se conservan porque verifican el comportamiento
del intérprete y ciclo de vida interno de sus imágenes. Si un producto necesita
un comando para personas, CI o despliegue, debe agregarlo como programa Node y
no reutilizar esos scripts internos.

Los valores sensibles se leen únicamente desde el entorno o Vault. Las
herramientas no aceptan credenciales por flags ni imprimen cuerpos de respuesta
que puedan contenerlas.
