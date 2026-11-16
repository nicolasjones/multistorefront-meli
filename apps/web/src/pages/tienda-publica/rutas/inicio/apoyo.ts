import { vi } from 'vitest'

// Apoyo común de los tests de la home (F-TDA-10): un solo mock del cliente de Supabase que responde por
// nombre de función pública. Las secciones no se importan acá.
export type Respuestas = Record<string, { data?: unknown; error?: { message: string } }>

export const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
export const HOST = 'mundojc.localhost'

export const mocks = { rpc: vi.fn() }

export function responder(respuestas: Respuestas) {
  mocks.rpc.mockImplementation(async (nombre: string) => ({ data: null, error: null, ...(respuestas[nombre] ?? {}) }))
}

export const categorias = {
  categorias: [
    { id: 'c-1', nombre: 'Joysticks', padre_id: null, productos: 3 },
    { id: 'c-2', nombre: 'Cargadores', padre_id: null, productos: 0 },
  ],
}

export const destacados = {
  hay_productos: true,
  productos: [
    { id: 'p-1', nombre: 'Joystick Pro', precio: 18455, disponible: true, imagen: 'o/p-1/a.png', categoria_id: 'c-1' },
    { id: 'p-2', nombre: '<b>Cable</b>', precio: null, disponible: false, imagen: null, categoria_id: null },
  ],
}
