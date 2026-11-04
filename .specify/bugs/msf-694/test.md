# Test MSF-694
- Unit `cuentasCliente.test.ts`: RPC `cuentas_web_de_cliente` falla -> resuelve `{creadas:0, errores:2}`, no invoca la función de invitación.
- Test de página `create.cuenta-web-falla.test.tsx`: con el RPC fallando, el alta crea el cliente una vez y navega a la ficha con el aviso (falla sin el arreglo).
