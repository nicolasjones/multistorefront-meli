# Contrato del núcleo de IA

Un consumidor declara un `contrato_id` y versión con esquema de entrada/salida, clasificación de datos permitidos, límites, acciones opcionales y verificadores. El núcleo sólo invoca al proveedor si existe política activa y devuelve un resultado sanitizado validado. No ejecuta efectos de negocio por sí mismo.

Cada consumidor define en su propia spec los datos y efectos concretos. Navegación será un consumidor futuro y deberá definir su sesión, orígenes, acciones y verificadores allí.

Las respuestas y eventos sólo incluyen IDs, estado, contadores y detalle sanitizado. Nunca incluyen secretos, sesiones, tokens, capturas ni datos excluidos por el contrato.

Las claves se aprovisionan a Vault desde configuración local ignorada por Git o variables del entorno de despliegue; Refine no expone alta, edición ni rotación de claves.
