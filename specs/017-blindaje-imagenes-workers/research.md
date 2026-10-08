# Research: Blindaje y publicación de imágenes de workers

## Decisiones

### D1. El contexto de build será la raíz del monorepo

- **Decisión**: El workflow usará la raíz como contexto y pasará el Dockerfile y el nombre del worker como argumentos. No usará `workers/<worker>` como contexto.
- **Racional**: Los workers copian `package.json`, `pnpm-workspace.yaml` y `pnpm-lock.yaml` desde la raíz; con el contexto de la subcarpeta esos archivos quedan fuera del contexto y el build no es reproducible.
- **Alternativas consideradas**: Duplicar los archivos raíz dentro de cada worker, rechazado por duplicación y deriva; un contexto por worker, rechazado por incompatibilidad con el monorepo actual.

### D2. Se usará una plantilla Docker parametrizada y se mantendrán imágenes separadas

- **Decisión**: `workers/Dockerfile` aceptará `WORKER` y producirá una imagen por integración. Cada worker conserva su `package.json`, código, dependencias y ciclo de versión.
- **Racional**: Reduce mantenimiento repetido sin aumentar el blast radius ni instalar dependencias de proveedores distintos en la misma imagen.
- **Alternativas consideradas**: Un Dockerfile por worker, aceptable pero con deriva garantizada entre integraciones; una imagen monolítica, rechazada por tamaño, aislamiento y rollback.

### D2a. Los nuevos workers se descubrirán por contrato

- **Decisión**: El pipeline enumerará los paquetes declarados bajo `workers/` y validará que cada uno tenga los archivos y scripts requeridos antes de construirlo. Las excepciones de runtime se declararán como configuración del worker, no como ramas ocultas del workflow.
- **Racional**: Agregar una integración debe ser una operación local y versionada, sin editar una lista central que pueda quedar desactualizada.
- **Alternativas consideradas**: Mantener una lista manual de workers, rechazada por riesgo de olvidar el build; construir cualquier carpeta sin validación, rechazado porque permitiría publicar directorios incompletos o fixtures.

### D3. Las imágenes serán contenedores Linux `amd64`

- **Decisión**: El artefacto se construirá como Linux `amd64`. Docker Desktop/WSL2 podrá ejecutarlo sobre Windows; Linux será el destino preferido para servidores.
- **Racional**: Coincide con los servidores y runners actuales, y evita añadir una matriz multi-arquitectura sin un host ARM que la requiera.
- **Alternativas consideradas**: `arm64` desde el inicio, rechazada por coste de build y validación sin requisito actual; Windows containers, rechazado porque el runtime de producción está previsto para Linux.

### D4. El release usará GHCR y referencias inmutables

- **Decisión**: Publicar cada imagen en GHCR con el nombre existente derivado del repositorio, conservar la referencia por SHA/digest y dejar `latest` fuera del contrato de Kestra. La publicación requiere `packages: write` solo en el job protegido.
- **Racional**: El workflow actual ya usa GHCR y Kestra recibe `envs.*_imagen`; una referencia inmutable permite diagnosticar y hacer rollback.
- **Alternativas consideradas**: Registry nuevo, rechazado por infraestructura adicional; solo `latest`, rechazado por no permitir reproducibilidad.

### D5. El umbral de seguridad bloqueará críticas y altas

- **Decisión**: El pipeline bloquea vulnerabilidades críticas y altas. Una excepción necesita justificación, responsable, fecha de vencimiento y referencia de seguimiento.
- **Racional**: Es la decisión aclarada en la spec y evita publicar riesgos de alto impacto sin impedir toda entrega por hallazgos moderados.
- **Alternativas consideradas**: bloquear solo críticas, rechazado por dejar un riesgo alto ejecutable; bloquear también moderadas, diferido hasta tener una política de excepciones y volumen de findings real.

### D6. Los workers seguirán siendo jobs puntuales despachados por Kestra

- **Decisión**: Mantener `docker pull` por digest seguido de `docker run --rm`; agregar restricciones de runtime sin cambiar parámetros, códigos de salida ni marcadores sanitizados de error.
- **Racional**: Es el contrato vigente de los flows y mantiene la operación por organización en servidores separados.
- **Alternativas consideradas**: convertir cada worker en servicio HTTP, rechazado por mayor superficie operativa y porque no resuelve la ejecución batch actual.

### D7. La salida de red será deny-by-default y declarativa

- **Decisión**: Cada worker tendrá una allowlist versionada de destinos necesaria para su integración. El runtime bloqueará cualquier otro destino y la prueba de contrato verificará tanto un destino permitido como uno rechazado.
- **Racional**: Los workers manejan credenciales y datos sensibles de cada organización; una salida abierta permite exfiltración aunque el contenedor no tenga privilegios.
- **Alternativas consideradas**: egress abierto documentado, rechazado por no ser una barrera efectiva; una allowlist global, rechazada porque mezcla necesidades de proveedores y amplía el blast radius.

## Investigación pendiente resuelta en el plan

- Los límites exactos de CPU, memoria, timeout y egress se fijarán a partir de los valores de los servidores y de cada integración durante la implementación; el contrato exige que existan y que sean comprobables.
- La retención concreta del registry se definirá con el mínimo de una versión anterior por worker y una política de limpieza que no borre referencias activas o de rollback.

## Verificación de alcance

- No se agregan tablas, migraciones, policies RLS ni funciones de Supabase.
- No se agregan secretos ni valores de proveedores al repositorio.
- No se crea un Compose raíz ni se fusionan los ciclos de despliegue de Refine, Kestra, Superset y workers.
- Los cambios de Kestra quedan limitados al contrato de lanzamiento, límites y referencia de imagen; no cambian el flujo de negocio de ningún proveedor.
