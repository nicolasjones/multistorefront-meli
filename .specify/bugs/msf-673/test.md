# Test: msf-673

- Tests `[MSF-673]` en `apps/web/src/lib/vencimientoSesion.test.ts`: tienda + marca de 13 h + clic/tecla → sin aviso ni cambio de marca; panel + 13 h → avisa una vez.
- Resultado: vitest 8/8 OK, `tsc -b` sin errores, oxlint ver abajo en el PR.
- E2E: no aplica (comportamiento de arranque cubierto por unit test).
