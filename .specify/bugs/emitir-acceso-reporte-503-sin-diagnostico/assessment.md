# Bug Assessment: Rentabilidad y Reportes no cargan en dev (503 sin pista del paso que falla)

- **Slug**: emitir-acceso-reporte-503-sin-diagnostico
- **Created**: 2026-11-23
- **Source**: reporte de Nicolás: todas las pantallas de Rentabilidad y Reportes muestran «No pudimos cargar esta información»
- **Verdict**: valid
- **Severity**: high

## Symptom

`emitir-acceso-reporte` responde `503 analitica_no_disponible` en dev para todos los tableros embebidos.

## Reproduction

Sesión de la cuenta demo en dev, `POST /functions/v1/emitir-acceso-reporte` con un `reporte_id` válido: 503 en ~1,2 s.
La base (RPC de reportes y empresas), Superset (`/health`) y las variables `SUPERSET_*` del runtime están bien.

## Root Cause

Pendiente: el handler devuelve el mismo 503 en siete pasos distintos (organización, lectura del reporte, empresas,
login de Superset, datasets vedados, guest token, red) y no registra cuál falló.

## Fix

Primer paso: cada 503 deja en el log del runtime el paso que falló y su causa (sin tokens ni datos del usuario).
El arreglo de fondo sigue en cuanto el log muestre el paso.

## Actualización (2026-11-23)

Con el log del primer paso, en dev falla `datasets_vedados`: `listarDatasets` devuelve `null` para todos los tableros
aunque los datasets de la allowlist (p. ej. `margen_real_categoria`) existen en Superset. Segundo paso: `listarDatasets`
registra el motivo exacto (HTTP, forma de la respuesta o paginación). Además, `inventario_productos_stock_cantidades`
y `service_reparaciones` están en la allowlist de dos reportes pero no existen como dataset en el Superset de dev.
