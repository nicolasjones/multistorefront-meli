# Fix MSF-694
- `cuentasCliente.ts`: la lectura previa `listarCuentasWebDeCliente` de `aplicarCuentaWebEnTiendas` va en try/catch; ante error devuelve `{creadas:0, errores: tiendas.length}` (el alta navega a la ficha con aviso parcial, sin reintento ni duplicado).
- Test unitario agregado; `docs/clientes.md` actualizado. Sin migraciones.
