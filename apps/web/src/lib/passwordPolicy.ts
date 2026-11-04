export const passwordPolicyDescription =
  'La contraseña debe tener al menos 12 caracteres e incluir mayúscula, minúscula, número y símbolo.'

export type PasswordPolicyResult =
  | { valid: true }
  | {
      valid: false
      message: string
    }

const hasUppercase = /[A-Z]/
const hasLowercase = /[a-z]/
const hasNumber = /\d/
const hasSymbol = /[^A-Za-z0-9]/

export const passwordRules = [
  { id: 'length', label: 'Al menos 12 caracteres', test: (value: string) => value.length >= 12 },
  { id: 'uppercase', label: 'Una mayúscula', test: (value: string) => hasUppercase.test(value) },
  { id: 'lowercase', label: 'Una minúscula', test: (value: string) => hasLowercase.test(value) },
  { id: 'number', label: 'Un número', test: (value: string) => hasNumber.test(value) },
  { id: 'symbol', label: 'Un símbolo', test: (value: string) => hasSymbol.test(value) },
] as const

export function validatePassword(password: string, confirmation?: string): PasswordPolicyResult {
  const meetsPolicy = passwordRules.every((rule) => rule.test(password))

  if (!meetsPolicy) {
    return { valid: false, message: passwordPolicyDescription }
  }

  if (confirmation !== undefined && password !== confirmation) {
    return { valid: false, message: 'Las contraseñas no coinciden.' }
  }

  return { valid: true }
}
