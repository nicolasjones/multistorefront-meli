import { describe, expect, it, vi } from 'vitest'
import {
  crearPerfilDesdeModeloDescubierto,
  descubrirModelos,
  descubrirYRegistrarModelos,
  proveedoresIniciales,
  type FetchModelos,
} from './index.js'

const respuesta = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('configuración IA gobernada', () => {
  it('mantiene el catálogo inicial cerrado de proveedores', () => {
    expect(proveedoresIniciales.map((proveedor) => proveedor.codigo)).toEqual([
      'openai', 'anthropic', 'google', 'xai', 'deepseek', 'alibaba-qwen', 'zhipu-glm', 'moonshot-kimi', 'baidu-ernie',
    ])
  })

  it('descubre modelos OpenAI compatibles sin incluir la clave en la URL ni en el error', async () => {
    const fetchModelos = vi.fn<FetchModelos>().mockResolvedValue(respuesta({ data: [{ id: 'modelo-fixture' }] }))
    await expect(descubrirModelos('deepseek', 'clave-privada', fetchModelos)).resolves.toEqual([{ modeloId: 'modelo-fixture', capacidades: {} }])
    expect(fetchModelos.mock.calls[0][0]).not.toContain('clave-privada')
    expect(fetchModelos.mock.calls[0][1].headers.Authorization).toBe('Bearer clave-privada')
  })

  it('normaliza el formato de Gemini y registra sólo el modelo y capacidades permitidas', async () => {
    const registrarModelos = vi.fn(async () => undefined)
    const repositorio = {
      obtenerClaveCredencial: async () => ({ proveedorCodigo: 'google', adaptador: 'gemini', clave: 'clave-fixture' }),
      registrarModelos,
      crearPerfil: async () => 'perfil-id',
    }
    const fetchModelos: FetchModelos = async () => respuesta({ models: [{ name: 'models/gemini-fixture', supportedGenerationMethods: ['generateContent'] }] })
    await expect(descubrirYRegistrarModelos(repositorio, 'credencial-id', fetchModelos)).resolves.toEqual([
      { modeloId: 'gemini-fixture', capacidades: { acciones: ['generateContent'] } },
    ])
    expect(registrarModelos).toHaveBeenCalledWith('credencial-id', [{ modeloId: 'gemini-fixture', capacidades: { acciones: ['generateContent'] } }])
  })

  it('rechaza configuración inconsistente y perfiles sin nombre', async () => {
    const repositorio = {
      obtenerClaveCredencial: async () => ({ proveedorCodigo: 'openai', adaptador: 'gemini', clave: 'clave-fixture' }),
      registrarModelos: async () => undefined,
      crearPerfil: async () => 'perfil-id',
    }
    const fetchModelos: FetchModelos = async () => respuesta({ data: [] })
    await expect(descubrirYRegistrarModelos(repositorio, 'credencial-id', fetchModelos)).rejects.toThrow('CREDENCIAL_IA_INCONSISTENTE')
    await expect(crearPerfilDesdeModeloDescubierto(repositorio, 'credencial-id', 'modelo', ' ')).rejects.toThrow('PERFIL_IA_INVALIDO')
  })
})
