# Contrato de ejecución de worker

## Lanzamiento

Kestra resuelve la organización, el servidor y la conexión con las funciones privadas existentes. Luego lanza el digest exacto en un host que soporte contenedores Linux.

Variables mínimas ya contractuales:

- `ORGANIZACION_ID`
- `SISTEMA_EXTERNO`
- `CONEXION_ID`
- parámetros propios de la integración
- `EJECUCION_ID` cuando el flow lo use

Los secretos llegan mediante el archivo de runtime del servidor o el mecanismo existente de Vault. Nunca forman parte de la imagen, de los argumentos persistidos del flow ni de los logs.

## Resultado

- código `0`: ejecución completada;
- código distinto de `0`: ejecución fallida y reintentable según el flow;
- `CREDENCIAL_INVALIDA:<conexion_id>`: marcador sanitizado para alertas de credencial;
- cualquier otro fallo: `FALLA_TECNICA_SANITIZADA` en el flujo de alerta, sin transmitir el error crudo.

## Restricciones de runtime

El lanzador debe aplicar, según los límites acordados por worker:

- ejecución como usuario no root;
- memoria, CPU y timeout explícitos;
- filesystem persistente de solo lectura cuando el worker lo permita y `/tmp` temporal para archivos necesarios;
- capabilities mínimas y sin Docker socket dentro del worker;
- egress denegado por defecto y allowlist versionada solo hacia Supabase, Vault y los dominios del proveedor necesarios para esa integración;
- eliminación automática del contenedor al terminar.

## Idempotencia y auditoría

El mismo `EJECUCION_ID` de negocio no puede producir registros duplicados al reintentarse. Los eventos deben permitir reconstruir worker, digest, organización, flow, intento, estado, timestamps y código de salida sin incluir credenciales.
