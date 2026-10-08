# Contrato: `workers/README.md`

Esta feature no expone una API ni una CLI — su única "interfaz" es el documento `workers/README.md` en sí: lo que promete a quien lo lea. Este contrato lista, de forma verificable, qué debe poder encontrar y afirmar correctamente alguien que lea el documento después del cambio. Sirve como criterio de aceptación para `/speckit-tasks` y para la verificación manual en `quickstart.md`.

## El documento, después de esta feature, DEBE permitir responder correctamente:

1. **¿En qué lenguaje se escribe un worker de integración por defecto, y es obligatorio?**
   → Node.js + TypeScript por defecto; no obligatorio si un caso puntual justifica otro runtime. (FR-001)

2. **¿Un worker puede integrar más de un sistema externo? ¿Cómo se organiza cuando ese sistema expone más de un tipo de dato?**
   → No, un worker se dedica a un único sistema externo. Cuando ese sistema expone varios tipos de dato o reporte, cada uno se implementa como un conector propio dentro del worker, aislado de los demás, cada uno con su propio método de acceso. (FR-002)

3. **¿Kestra reemplaza al worker, o lo complementa? ¿Cómo se dividen las responsabilidades?**
   → Kestra programa/reintenta/alerta; el worker ejecuta el trabajo técnico (API, automatización de navegador, descarga/procesamiento de archivos, validación e importación). No hay redundancia. (FR-003)

4. **¿Cómo se normalizan datos que vienen de múltiples fuentes del mismo dominio, sin una tabla por sistema?**
   → Patrón de tabla central: columna de organización dueña del dato + `origen` + `id_externo` como clave compuesta de idempotencia (nunca `id_externo` solo, ni `origen`+`id_externo` sin la organización), y una columna `jsonb` para los datos particulares de cada fuente. (FR-004)

4b. **¿La tabla central es una excepción al aislamiento multi-tenant del resto del template?**
   → No. Lleva columna de organización y RLS como cualquier tabla expuesta, aunque la escriba un worker en vez de un usuario desde la UI. (FR-011)

4c. **¿Un worker solo puede tener una tabla central, aunque integre sistemas que producen distintos tipos de dato?**
   → No. Es una tabla central por cada tipo de registro de negocio (movimientos, balances de mayor, facturas, etc.) — un mismo conector puede escribir en más de una si su sistema expone más de un tipo. (FR-004b)

5. **¿La tabla central es algo que el template provee directamente, o algo que cada implementación adapta?**
   → Es una convención de diseño; cada spec que la implemente la adapta a su propio dominio. No es un esquema, migración ni tabla que el template entregue. (FR-005)

6. **¿Qué significa "healthcheck" para un worker que Kestra dispara y que termina al finalizar (no un servicio persistente)?**
   → El código de salida/estado que Kestra ya registra — sin necesidad de un endpoint HTTP separado. Un worker que sea un servicio persistente queda fuera de esta convención. (FR-006)

7. **¿El documento nombra alguna marca, empresa, sistema externo concreto o cualquier otro concepto de negocio de los casos que la motivaron?**
   → No, en ningún punto. (FR-007) — verificable por revisión de texto (SC-003).

8. **¿Esta convención resuelve procesamiento en tiempo real (colas) o un backend síncrono para un frontend?**
   → No — ambos quedan explícitamente fuera de alcance, como decisión propia de cada implementación. (FR-008)

9. **¿Por qué esta convención vive en el template y no en una implementación puntual?**
   → Porque surge de al menos dos automatizaciones de dominios de negocio independientes que llegaron al mismo patrón sin coordinación. (FR-009)

10. **¿Dónde se guardan las credenciales que un conector necesita para acceder a su sistema externo?**
    → Vía el mecanismo de manejo de secretos ya establecido en el proyecto (nunca en Git, solo en gestores de variables o vault por entorno) — sin un mecanismo nuevo específico para conectores. (FR-010)

11. **¿Quién decide a qué organización pertenece cada registro que un conector importa?**
    → La organización dueña de la conexión/credencial que el worker usó para esa ejecución — el worker la propaga a cada fila que escribe, no es algo que el conector infiera de los datos en sí. (FR-011, `data-model.md`)

## Fuera del contrato (a propósito)

- Nombres de columnas de dominio, esquemas SQL reales, o cualquier detalle específico de una implementación puntual — eso lo define cada spec puntual, no este documento.
- Cualquier mención a Redis, BullMQ o un backend HTTP síncrono como parte de esta convención (si aparecen, debe ser para decir explícitamente que quedan fuera, no para incorporarlos).
