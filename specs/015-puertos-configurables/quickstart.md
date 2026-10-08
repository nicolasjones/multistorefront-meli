# Quickstart: Puertos de Desarrollo Local Configurables

Valida las tres historias de usuario de la spec: cero regresión sin `.env`,
correr dos stacks en paralelo, y ausencia de puertos hardcodeados sueltos.

## Prerrequisitos

- Docker Desktop corriendo.
- Node 24+, pnpm 11+, Supabase CLI (se instala con las dependencias del
  repositorio).
- Dos checkouts del repositorio en carpetas distintas (puede ser el mismo
  repo clonado dos veces, o el template + un fork).

## 1. Cero regresión sin `.env` (US1, SC-003)

```powershell
# En un checkout limpio, sin copiar ningún .env
pnpm infra:config
pnpm dev:supabase
pnpm dev:refine
```

**Resultado esperado**: los servicios quedan en los mismos puertos que antes
de esta feature (3100, 8100, 5434, 8082, 8088, 3103, etc. — ver
`contracts/variables-puerto.md`). Nadie que ya use el template hoy nota un
cambio de comportamiento.

```powershell
pnpm dev:down:refine
pnpm dev:down:supabase
```

## 2. Dos stacks en paralelo (US1, SC-001, SC-004)

En el segundo checkout, copiar `.env.example` a `.env` (y a
`infra/<producto>/.env` donde corresponda) y sobreescribir únicamente las
variables de puerto de `contracts/variables-puerto.md` con valores distintos
— por ejemplo, sumando 1000 a cada default. Editar también, a mano, los
puertos de `supabase/config.toml` en ese segundo checkout (la excepción
documentada).

```powershell
# Checkout 1 (valores por defecto)
pnpm infra:config
pnpm dev:supabase
pnpm dev:refine

# Checkout 2 (valores +1000, en otra terminal)
pnpm infra:config
pnpm dev:supabase
pnpm dev:refine
```

**Resultado esperado**: ambos comandos terminan sin error de puerto ocupado.
Cada stack responde en el puerto que su propio `.env` declara — confirmarlo
abriendo `http://localhost:3100` y `http://localhost:4100` (o los puertos
elegidos) y viendo la interfaz de Refine de cada uno por separado.

```powershell
# Limpiar ambos
pnpm dev:down:refine
pnpm dev:down:supabase
```

## 3. Sin puertos hardcodeados sueltos (US2, US3, SC-002)

```bash
# Por cada default de contracts/variables-puerto.md, confirmar que solo
# aparece en su propia variable, en .env.example, o en supabase/config.toml
grep -rn "\b3100\b" --include="*.yaml" --include="*.ts" --include="*.py" --include="*.toml" --include="*.env*" .
```

**Resultado esperado**: las únicas apariciones fuera de `.env.example` y del
archivo consumidor leyendo la variable están dentro de `supabase/config.toml`
(la excepción documentada, con su comentario). Repetir para cada puerto de
la tabla de `contracts/variables-puerto.md`.

## 4. Auth y CORS siguen funcionando (regresión del hallazgo original)

Con el checkout 2 (puertos +1000) corriendo:

1. Entrar a `http://localhost:4100`, pedir "olvidé mi contraseña".
2. Confirmar en Mailpit (`http://localhost:<SUPABASE_MAILPIT_PORT>`) que el
   link del mail apunta a `http://localhost:4100/...` (no al puerto por
   defecto del template).
3. Si el checkout 2 tiene Superset levantado, entrar a un reporte embebido y
   confirmar que no aparece un error de CORS en la consola del navegador.

**Resultado esperado**: ambos flujos funcionan en el checkout con puertos
no-default — esto es lo que falló manualmente la primera vez (redirects de
Auth y CORS de Superset quedaron con el puerto viejo) y esta feature existe
para que no vuelva a pasar.
