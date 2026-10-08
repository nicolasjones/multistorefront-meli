# Plan: Separación local por producto

## Decisiones

- El monorepo se mantiene único; Docker se segmenta por producto.
- Refine recibe un contenedor de desarrollo con recarga sobre el código montado.
- Supabase sigue siendo controlado por su CLI, porque administra su propio
  conjunto de contenedores y migraciones.
- Kestra y Superset tienen Compose y despliegue VPS separados.
- Los volúmenes de los stacks anteriores no se eliminan durante la transición.

## Archivos y validación

| Producto | Archivos | Validación |
|---|---|---|
| refine | `infra/refine/Dockerfile`, `infra/refine/compose.yaml` | HTTP 200 en puerto 3100 |
| supabase | `supabase/config.toml` | health de Auth y Studio |
| kestra | `infra/kestra/compose.yaml` | `docker compose config --quiet` |
| superset | `infra/superset/compose.yaml` | HTTP 200 en `/health` |
| SDD | `specs/`, `AGENTS.md`, `CLAUDE.md` | revisión de alcance y tareas |

## Riesgos

- La imagen de Kestra se fija en `v1.3.35`; la primera descarga puede tardar
  por su tamaño.
- Al cambiar el identificador local de Supabase se inicia un entorno nuevo; el
  entorno anterior se mantiene detenido como respaldo hasta decidir borrarlo.
