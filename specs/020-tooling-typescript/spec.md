# Especificación: Tooling TypeScript sin Shell propio

**Rama**: `020-tooling-typescript`  
**Creada**: 2026-09-23  
**Estado**: Implementada
**Alcance de entrega**: `kestra`, `workers`

## Escenarios de usuario y pruebas

### Historia 1 - Operar en cualquier entorno soportado (Prioridad: P1)

Como mantenedor de la plataforma, necesito ejecutar las herramientas de desarrollo, validación, despliegue y recuperación con una interfaz consistente, sin mantener variantes en PowerShell o Shell.

**Prueba independiente**: ejecutar cada comando público documentado en Windows y en el entorno de automatización correspondiente, verificando el mismo resultado y código de salida.

**Criterios de aceptación**:

1. Dado un comando operativo documentado, cuando se ejecuta en un entorno soportado, entonces conserva sus entradas, salida sanitizada y código de salida esperado.
2. Dado un fallo de una herramienta, cuando termina, entonces informa un error accionable sin imprimir secretos.

---

### Historia 2 - Mantener los contenedores sin lógica Shell propia (Prioridad: P2)

Como mantenedor de imágenes y fixtures, necesito que los entrypoints y preparaciones mantenidos por el equipo no contengan lógica en archivos Shell o PowerShell.

**Prueba independiente**: construir las imágenes propias y ejecutar sus healthchecks/fixtures sin archivos propios de esas extensiones.

**Criterios de aceptación**:

1. Dada una imagen o fixture propio, cuando se inspecciona, entonces no depende de un archivo Shell o PowerShell mantenido por el repositorio.
2. Dado un requisito interno de una imagen de terceros o de Docker, cuando no pueda eliminarse, entonces queda como dependencia técnica explícita y no como lógica operativa propia.

---

### Historia 3 - Adoptar la herramienta desde un producto derivado (Prioridad: P3)

Como responsable de un producto derivado, necesito adoptar las herramientas comunes sin perder comandos o validaciones particulares de mi producto.

**Prueba independiente**: seguir una guía de adopción sobre un producto con comandos propios y confirmar que sus equivalentes se ejecutan sin scripts Shell/PowerShell propios.

### Casos límite

- Una herramienta se interrumpe durante un despliegue o publicación parcial.
- Una variable de entorno requerida no existe o contiene un secreto.
- Un contenedor base no incluye el runtime requerido por un entrypoint propio.
- Un comando histórico se invoca desde CI o documentación durante la transición.

## Requisitos

### Requisitos funcionales

- **FR-001**: La plataforma DEBE reemplazar los archivos operativos propios con extensiones PowerShell, Shell, Batch o Command por herramientas mantenibles en el runtime estándar del repositorio.
- **FR-002**: La transición DEBE conservar los contratos públicos de comandos o documentar una sustitución compatible antes de retirar cada comando anterior.
- **FR-003**: Las herramientas DEBEN validar entradas, propagar códigos de salida útiles y sanitizar secretos en errores y registros.
- **FR-004**: Las herramientas DEBEN funcionar en los entornos de desarrollo, CI y despliegue que les correspondan, sin requerir una API de aplicación siempre activa.
- **FR-005**: La plataforma DEBE distinguir scripts propios de comandos internos de Docker, sistema operativo o imágenes de terceros; estos últimos no se duplican ni se disfrazan como herramientas propias.
- **FR-006**: La adopción por un producto derivado DEBE ser incremental y no eliminar sus comandos particulares hasta contar con un reemplazo validado.

## Criterios de éxito

- **SC-001**: El repositorio no contiene archivos operativos propios con extensiones `.ps1`, `.sh`, `.bash`, `.cmd` o `.bat` una vez concluida la migración aplicable.
- **SC-002**: El 100% de los comandos migrados conserva validación automatizada en su entorno correspondiente.
- **SC-003**: Un producto derivado puede adoptar la herramienta común sin introducir una API Node persistente ni un servicio adicional.

## Supuestos y límites

- Node/TypeScript es ya el runtime de workers y herramientas del monorepo.
- Esta spec no agrega un backend Node entre el panel y Supabase.
- No obliga a eliminar el intérprete interno que Docker o una imagen de terceros pueda usar durante su propio arranque.
- Las herramientas específicas de dominio se migran en la spec de adopción de cada producto.
