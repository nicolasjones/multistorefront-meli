# Contrato de imagen de worker

## Entrada de build

El pipeline recibe:

| Campo | Regla |
|---|---|
| `WORKER` | Nombre exacto de una carpeta bajo `workers/` con `package.json` y código compilable |
| `SOURCE_COMMIT` | Commit del checkout que se está construyendo |
| `PLATFORM` | `linux/amd64` en la primera versión |

El contexto de build es la raíz del repositorio. No se permiten archivos `.env`, claves privadas, `node_modules`, `.git` ni artefactos de otros workspaces en el contexto enviado al builder.

## Salida publicada

Cada worker produce un repositorio de imagen independiente:

```text
ghcr.io/<owner>/<repository>-worker-<worker>:<commit-sha>
```

El digest publicado es la referencia canónica para flows y rollback. `latest` puede existir como alias operativo mientras se migra el consumo, pero no debe ser la referencia persistida en Kestra.

La publicación incluye:

- digest de imagen;
- SBOM;
- provenance/attestation del workflow;
- resultado del escaneo de vulnerabilidades;
- commit y worker asociados.

## Reglas de rechazo

- El build falla si no puede reproducirse con lockfile congelado.
- El release falla ante vulnerabilidades críticas o altas, salvo excepción aprobada y vigente.
- El release falla si el digest publicado no coincide con el digest informado al consumidor.
- El release falla si se detecta un secreto en el artefacto o en los metadatos publicados.
