import { describe, expect, it } from 'vitest'
import { passwordPolicyDescription, passwordRules, validatePassword } from './passwordPolicy'

describe('validatePassword', () => {
  it('accepts a password that meets every required category', () => {
    expect(validatePassword('ContrasenaSegura1!', 'ContrasenaSegura1!')).toEqual({ valid: true })
  })

  it.each([
    ['less than 12 characters', 'Corta1!'],
    ['no uppercase letter', 'contrasenasegura1!'],
    ['no lowercase letter', 'CONTRASENASEGURA1!'],
    ['no number', 'ContrasenaSegura!'],
    ['no symbol', 'ContrasenaSegura1'],
  ])('rejects a password with %s', (_reason, password) => {
    expect(validatePassword(password)).toEqual({
      valid: false,
      message: passwordPolicyDescription,
    })
  })

  it('accepts exactly 12 characters and rejects 11', () => {
    expect(validatePassword('Abcdefghij1!')).toEqual({ valid: true })
    expect(validatePassword('Abcdefghi1!').valid).toBe(false)
  })

  it('exposes one rule per requirement so the policy is adjusted in a single place', () => {
    expect(passwordRules.map((rule) => rule.id)).toEqual(['length', 'uppercase', 'lowercase', 'number', 'symbol'])
  })

  it('rejects a confirmation that does not match without exposing either value', () => {
    const password = 'ContrasenaSegura1!'
    const result = validatePassword(password, 'OtraContrasena2!')

    expect(result).toEqual({ valid: false, message: 'Las contraseñas no coinciden.' })
    if (!result.valid) {
      expect(result.message).not.toContain(password)
    }
  })
})
