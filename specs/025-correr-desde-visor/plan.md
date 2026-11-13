# Plan: correr desde el visor

## Enfoque

1. **Runner local, no producto.** `tools/e2e-runner/server.py` (Python stdlib)
   usa el `gh` de la máquina para disparar `validate.yml` y bajar artefactos.
   Config en `~/.config/e2e-runner.json` (URL + service key), fuera de git.
2. **El visor no sabe de GitHub.** Sólo conoce `{runner}/correr` y
   `{runner}/estado`; el build del producto no define la URL y no muestra nada.
3. **Mismo contrato de publicación.** Reutiliza el manifiesto y las claves ASCII
   de `scripts/subir-evidencias-e2e.mjs`, y actualiza `latest/`.
4. **Un run por vez.** Estado en memoria + 409.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `.github/workflows/validate.yml` | Input `e2e_grep` y `--grep` en el job con sesión |
| `apps/web/src/pages/cobertura-e2e/show.tsx` | Botón, estado y polling (gated por env) |
| `tools/e2e-runner/server.py` | Runner local (dispatch, descarga, publicación) |
| `docs/e2e-app.md` | Cómo levantarlo y cómo compilar el visor |

## Verificación

- Corrida real desde el runner para `MSF-121`: video nuevo en el bucket y ficha
  recargada.
- Build sin `VITE_E2E_RUNNER_URL`: el botón no aparece.
