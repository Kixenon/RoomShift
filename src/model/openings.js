export const OPENING_MODELS = Object.freeze(['window', 'door']);

export const isOpeningObject = (object) => OPENING_MODELS.includes(object?.model);
