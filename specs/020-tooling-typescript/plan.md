# Plan de implementación: Tooling Node sin Shell propio

**Rama**: `020-tooling-typescript` | **Fecha**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

## Resumen

Reemplazar utilidades operativas propias por programas Node mantenidos bajo
`scripts/` e `infra/`. Los comandos de `package.json`, CI y documentación se
actualizan en el mismo cambio. Docker, imágenes de terceros y sus comandos
internos permanecen fuera de esta migración.

## Decisiones

1. Node ESM es el runtime común; no se crea servidor HTTP ni API persistente.
2. Cada utilidad valida argumentos antes de ejecutar procesos hijos, redacta
   errores que puedan contener secretos y propaga el código de salida.
3. Los entrypoints internos de imágenes y fixtures de terceros se inventarían
   como excepción técnica explícita; no se disfrazan de herramientas propias.
4. La migración se hace por grupos: comandos públicos, validadores, fixtures y
   documentación/CI. Un archivo anterior se retira sólo tras validar su relevo.

## Estructura

```text
scripts/*.mjs                         comandos de desarrollo, CI y VPS
infra/ia/*.mjs                        aprovisionamiento de credenciales IA
infra/kestra/*.mjs                    render, publicación y validaciones
infra/*/fixtures/**                   excepciones internas de Docker
docs/adoptar-tooling-typescript.md    adopción incremental por derivados
```

## Chequeo constitucional

No hay cambio de datos, RLS, navegador ni arquitectura de despliegue. Las
herramientas sólo invocan Docker, Supabase o Kestra desde el entorno operativo
correspondiente y no reciben secretos por argumentos de línea de comandos.
