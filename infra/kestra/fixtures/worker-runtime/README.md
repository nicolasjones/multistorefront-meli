# Fixture de runtime

El harness usa este contrato sin credenciales reales: `success` termina con 0,
`technical-failure` con código 42 y `invalid-credential` sale con el código
no reintentable 78 (`workers/CONTRATO.md`) y solo emite la marca
sanitizada `CREDENCIAL_INVALIDA:fixture`. Nunca se imprimen valores secretos.
