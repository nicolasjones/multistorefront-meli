# Modelo de datos: blindaje de secretos

No se agrega una tabla ni se modifican datos históricos. La migración es
aditiva y crea el contrato de acceso efímero siguiente.

## Roles

### `workers_orquestacion`

Rol de grupo sin login. Recibe `EXECUTE` exclusivamente sobre
`private.obtener_credencial_para_worker(uuid)`; no recibe `SELECT` sobre
`conexiones`, `servidores_organizacion` ni `vault.decrypted_secrets`.

Cada `worker_<organizacion_id>` creado por
`public.aprovisionar_servidor_organizacion` pertenece a este grupo. El rol
`kestra_orquestacion` no pertenece a él.

## Función de acceso efímero

### `private.obtener_credencial_para_worker(p_conexion_id uuid) → text`

| Regla | Validación |
|---|---|
| Actor | `session_user` debe ser un rol worker miembro de `workers_orquestacion`. |
| Pertenencia | El rol debe coincidir con `servidores_organizacion.rol_db` de la organización dueña de `p_conexion_id`. |
| Fuente | Solo tras ambas validaciones puede leer el secreto desde `vault.decrypted_secrets`. |
| Resultado | Devuelve el valor al proceso worker; no lo escribe en tablas, logs ni metadatos. |
| Fallo | Lanza un error sin el valor de la credencial y sin revelar pertenencia de otra organización. |

## Datos operativos conservados

`conexiones`, `alertas` y la ejecución de Kestra conservan únicamente
`organizacion_id`, `conexion_id`, tarea, intento, estado, tipo (`tecnica` o
`credencial`) y `motivo` sanitizado. No se agrega una columna de secreto ni se
persiste una representación codificada.

## Reversión

La migración documentará el orden inverso: revocar `EXECUTE`, eliminar la
función, remover membresías de `workers_orquestacion` y finalmente eliminar el
rol de grupo solo si ya no tiene miembros. No se destruyen tablas ni Vault.
