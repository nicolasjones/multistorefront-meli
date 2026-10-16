# Marcas de CIERRE (avance determinístico, FEAT-117)

Las tareas de **esta** historia (MSF-502) quedaron hechas. Vive en un archivo **por-historia** para no chocar el `tasks.md` compartido entre historias.

- [x] T001
- [x] T017 — Desvío: no hay recorrido E2E con sesión (la suite de MSF-499 solo cubre rutas públicas; falta fixtures por rol, ver `docs/e2e-app.md`). Seguimiento: MSF-506.
- [x] T018 — Desvío: `docs/clientes.md` (modelo, tipo, Consumidor final, `escala_de_cliente`, reversión) y `docs/permisos-por-rol.md` (contrato `nivel_seccion('clientes')`) ya están en la épica. Búsqueda y exportación no se documentan porque `buscar_clientes`/`exportar_clientes` aún no existen. Seguimiento: MSF-507.
- [x] T020 — Desvío: validación local `pnpm lint` (solo warnings), `pnpm build`, `pnpm docs:check` OK; Vitest de clientes 28/28. `pnpm test` completo y pgTAP no corridos aquí (necesitan `pnpm dev:supabase`; los corre el CI). Revisión de RLS hecha sobre `20261016130200`/`130300` (políticas por `nivel_seccion`, `revoke` a `anon`, grants por columna, disparadores `security definer` con `search_path = ''` y `revoke execute`). `exportar_clientes` no existe todavía: su revisión, la matriz de Depósito (SC-006) y las contradicciones con el prototipo quedan en MSF-507.
- [x] T021 — Seguimiento abierto: MSF-505 (trasladar `public.clientes` a `dominio`).
- [x] T022 — Desvío: se ejecuta al mergear el PR (merge commit `--no-ff`); no se adelanta. Seguimiento: paso manual de cierre de MSF-502 sobre la fila de `docs/roadmap-template.md`.
