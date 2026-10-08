# Diseñar un conector de integración

Guía de proceso para la primera spec que conecte un producto derivado con un
sistema externo. Complementa la [convención de workers](../workers/README.md):
esa convención define el contrato estable del template; esta guía ayuda a
decidir qué pertenece al producto y qué, con evidencia suficiente, podría
volver al template más adelante.

## Punto de partida: plataforma y dominio

El template aporta los mecanismos reutilizables: organizaciones y RLS,
orquestación, acceso efímero a secretos, Playwright, el contrato de workers y
el esquema vacío `dominio`. El producto derivado define en su propia spec los
datos, reglas y automatizaciones de negocio.

Por ejemplo, si un conector importa un tipo de registro de negocio, su tabla
vive en `dominio`, con sus políticas RLS y sus migraciones aditivas. No se
agrega una tabla de ese dominio a `public` ni al template. La convención de
tabla central, `origen`, `id_externo` e idempotencia está en
`workers/README.md`; las columnas concretas son decisión de la spec del
producto.

## Qué se generaliza y qué permanece local

La regla es simple: **las convenciones baratas se generalizan; el comportamiento
del sistema externo espera evidencia de un segundo caso real.**

Se pueden reutilizar o proponer para el template sin conocer el dominio:

- nombres y contratos de entrada/salida del worker;
- separación entre worker, conector y flow de Kestra;
- RLS, auditoría, idempotencia, fixtures y sanitización de secretos;
- la ubicación de las tablas de negocio en `dominio`.

Permanece en el producto y en el conector concreto:

- login, cookies, sesiones, selectores, menús y esperas de un sistema externo;
- formatos y columnas de archivos de ese sistema;
- reglas de normalización y tablas de un dominio de negocio;
- cualquier infraestructura nueva que todavía no responda a un caso de uso
  confirmado.

Un mismo worker puede extraer a `core/` código que dos conectores reales de
ese mismo sistema ya comparten. No se crea una abstracción entre sistemas
externos distintos solo porque sus nombres parezcan similares.

## Contexto operativo del conector

Un producto puede mantener `workers/<sistema>/CONTEXTO.md` para registrar
hallazgos operativos que hagan reproducible el mantenimiento del conector:
forma de autenticación, restricciones de sesión, pasos de navegación, datos
de prueba permitidos y evidencia de validación. Ese documento pertenece al
producto; no debe contener credenciales, cookies, URLs privadas ni detalles
que hagan reconocible a una organización.

Cuando un hallazgo demuestra una regla independiente del sistema o del
dominio, se propone una actualización pequeña de esta guía o de
`workers/README.md`, acompañada por la evidencia de al menos dos casos reales.

## Detección temprana de cambios externos

Los fixtures cubren la lógica determinista del producto. No reemplazan una
prueba contra la interfaz real de un tercero: un cambio de esa interfaz se
detecta normalmente mediante la ejecución y alerta operativa.

Un chequeo periódico de tipo canario contra un sistema externo es una opción
futura, no una capacidad habilitada por este template. Solo se especifica si
hay una cuenta de prueba dedicada, un caso de negocio para detectarlo antes de
la próxima ejecución y una política clara para sus secretos, costo y alertas.
