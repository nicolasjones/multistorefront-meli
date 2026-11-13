// Tope de espera para un envío (M-2). Módulo aparte de `correo.ts` (importa denomailer desde una URL de Deno)
// para probarlo con `node --test`.

/**
 * Corta la espera de `promesa` a los `ms` (AbortSignal.timeout): un SMTP colgado no puede superar la reserva
 * de la cola. Falla con un error `TimeoutError` («smtp timeout»); el envío en curso se descarta al cerrar el cliente.
 */
export function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  const senal = AbortSignal.timeout(ms)
  return new Promise<T>((resolver, rechazar) => {
    const alAbortar = () => rechazar(new DOMException('smtp timeout: el servidor no respondió a tiempo', 'TimeoutError'))
    if (senal.aborted) return alAbortar()
    senal.addEventListener('abort', alAbortar, { once: true })
    promesa.then(
      (valor) => { senal.removeEventListener('abort', alAbortar); resolver(valor) },
      (error) => { senal.removeEventListener('abort', alAbortar); rechazar(error) },
    )
  })
}
