---
name: kestra-orquestacion
description: Diseña, revisa o modifica flows y operación de Kestra en esta plataforma. Úsala para automatizaciones durables, despacho de workers, reintentos, alertas, secretos o Compose de Kestra; no para una tarea aislada dentro de un worker.
---

# Kestra y orquestación

Trabaja sobre `infra/kestra/flows/` y conserva a Kestra como orquestador: la lógica de integración y los efectos aislables viven en `workers/`.

- Antes de cambiar un flow, lee la spec que lo introdujo y declara su alcance `kestra` y/o `workers`. Todo flujo debe ser idempotente, conservar estados, timestamps y errores sanitizados.
- Las credenciales nunca viajan en YAML, inputs, outputs ni logs. Usa las rutas de Vault y `secret()` ya definidas; no conviertas una clave en `envs.*` ni la resuelvas en una Edge Function o en el navegador.
- Mantén el patrón de despliegues separados: `infra/kestra/compose.yaml`, sin Compose raíz. Respeta los puertos configurables y no publiques puertos internos sin una necesidad de producto documentada.
- Para flujos con navegador usa el servicio Playwright existente solo cuando una spec lo requiera; no agregues una imagen pesada ni un runtime duplicado a cada ejecución.
- Valida configuración con `pnpm infra:config:kestra`. Para una automatización nueva o sensible, una validación estática no sustituye una ejecución real y sanitizada del flow.
