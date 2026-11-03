// Texto de consentimiento para guardar a una persona en la libreta de contactos (F-CON-05, FR-004).
// Decisión abierta 1 de la spec: el texto definitivo y el plazo de conservación los define el cliente.
// Mientras tanto vive acá como constante versionada y marcada «pendiente de aprobar»; cada contacto
// guarda una COPIA del texto con el que se aceptó, así cambiar esta constante no reescribe el pasado.
export const VERSION_CONSENTIMIENTO = 'v1-pendiente'

export const TEXTO_CONSENTIMIENTO =
  'La persona aceptó que la empresa guarde su nombre, correo y teléfono para responderle y llevar el historial de sus consultas y compras. Puede pedir que se anonimicen en cualquier momento. (Texto pendiente de aprobar por el cliente, ' +
  VERSION_CONSENTIMIENTO +
  '.)'
