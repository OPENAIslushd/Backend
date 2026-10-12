import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { ServiceError } from './core.js';

export const orchestratorSchema = JSON.parse(readFileSync(new URL('../contracts/orchestrator-request.schema.json', import.meta.url), 'utf8'));
export const uiSchema = JSON.parse(readFileSync(new URL('../contracts/ui-response.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
ajv.addSchema(orchestratorSchema);
ajv.addSchema(uiSchema);
const validators = new Map();
export function validate(schema, value) {
  let validator = validators.get(schema);
  if (!validator) {
    validator = ajv.getSchema(schema) ?? ajv.compile({ $ref: schema });
    validators.set(schema, validator);
  }
  if (!validator(value)) {
    throw new ServiceError('CONTRACT_VALIDATION', 'Payload does not match the versioned contract', 400,
      validator.errors.map(({ instancePath, keyword, message }) => ({ path: instancePath, keyword, message })));
  }
  return value;
}
export const validateRequest = value => validate(orchestratorSchema.$id, value);
export const validateUi = value => validate(uiSchema.$id, value);
export const validateDefinition = (name, value) => validate(`${orchestratorSchema.$id}#/definitions/${name}`, value);
