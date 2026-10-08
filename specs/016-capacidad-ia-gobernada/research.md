# Investigación: IA gobernada

## Decisiones

| Tema | Decisión | Alternativa descartada |
|---|---|---|
| Consumidores | Biblioteca interna común; cada consumidor declara contrato y su propia spec. | Un producto o navegador implícito como alcance global. |
| Respuesta | JSON validado por esquema de salida del contrato; no puede ejecutar efectos sin validador del consumidor. | Modelo controlando procesos locales. |
| Catálogo | Cerrado y agnóstico mediante adaptadores; modelos descubiertos con la clave. | Modelos/nombres fijados en código. |
| Secretos | Archivo local ignorado o variables de despliegue alimentan un script autorizado que guarda en Vault; sólo el runtime autorizado lee/descarta. | Refine, Kestra, browser o logs transportando clave. |
| Fallback | Una vez sólo por timeout/error técnico/respuesta inválida antes de propuesta válida; comparte dos intentos/90 s. | Fallback tras rechazo de política/verificador. |
| Retención | Purga idempotente a 90 días de detalle y objeto; conserva agregado no sensible. | Borrado manual o retención indefinida. |

Kestra OSS persiste outputs regulares en texto claro: los eventos se limitan a IDs, estado, contadores y error sanitizado. El adaptador debe redactar representaciones literal, URL-encoded y Base64 de la clave antes de stdout, stderr, alertas o persistencia.
