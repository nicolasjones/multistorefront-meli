# Test: msf-696

- `src/lib/whatsapp.test.ts`: locales con/sin 0 y 15, `+54`, `00`, `54` sin 9, internacional no AR, ambiguos → null, idempotencia.
- `src/pages/consultas/responder.test.tsx`: teléfono local → `wa.me/5491155551234`; sin área → sin enlace.
- Resultado: 7 archivos / 114 tests verdes (whatsapp, consultas, tienda-publica/whatsapp).
