# Quickstart: validar la convención de workers de integración

No hay nada que instalar ni ejecutar — esta feature es una edición de documentación. La validación es una lectura dirigida de `workers/README.md` contra el contrato de esta spec.

## Prerrequisitos

- La tarea de `/speckit-implement` que actualiza `workers/README.md` ya aplicada en la rama.
- Tener a mano `specs/012-workers-conector-node-kestra/contracts/workers-readme-contract.md`.

## Pasos

1. Abrir `workers/README.md` en el repo.
2. Recorrer, una por una, las 13 preguntas de `contracts/workers-readme-contract.md` (incluidas 4b y 4c). Para cada una, confirmar que el documento la responde sin ambigüedad y sin tener que inferir nada que no esté escrito.
3. Revisar el texto completo del archivo en busca de cualquier nombre de marca, empresa o sistema externo concreto, o de terminología propia de un dominio de negocio puntual (por ejemplo, vocabulario contable o de comercio electrónico) — **no debe aparecer ninguno**, salvo dentro de una frase que lo excluya explícitamente del alcance (FR-007). Tampoco debe aparecer `Redis`, `BullMQ`, ni referencia a un backend HTTP síncrono, salvo para decir explícitamente que quedan fuera (FR-008).
4. Confirmar que la sección nueva no contradice ni duplica el contrato de worker que ya existía en el archivo antes de esta feature (estructura de carpeta, Dockerfile, idempotencia, pruebas) — debe leerse como una extensión, no como una segunda fuente de verdad paralela.
5. (Opcional, prueba de consistencia) Pedirle a alguien sin contexto previo del proceso de diseño que lea solo `workers/README.md` y describa en sus palabras: el runtime por defecto, qué es un conector, y qué es la tabla central. Si lo describe correctamente sin preguntar nada más, se cumple SC-001.

## Resultado esperado

Las 13 respuestas del contrato están cubiertas, ningún término prohibido aparece fuera de una exclusión explícita, y el documento sigue siendo un único archivo coherente (`workers/README.md`) — sin archivos nuevos, sin dependencias, sin servicios.

## Qué NO valida este quickstart

- No valida ningún worker real construido — esta spec no crea código de worker, solo la convención que un futuro worker deberá seguir.
- No requiere levantar Kestra, Docker ni ningún servicio del template.
