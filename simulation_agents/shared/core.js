import { createHash } from 'node:crypto';

export const CHANNELS = ['paid_social', 'paid_search', 'influencer'];
export const MODEL_VERSION = 'numerical-mvp-1.0.0';
export const CONTRACT_VERSION = '1.0';
export const CREATIVE_FACTORS = { proof: 1, discovery: 1.08, offer: 1.03 };

export class ServiceError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}
export function assert(condition, message, code = 'INVALID_INPUT', status = 400) {
  if (!condition) throw new ServiceError(code, message, status);
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function rng(seed) {
  let state = Number.parseInt(digest(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(random) {
  return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
}
export function lognormal(random, relativeSd) {
  const sigma = Math.sqrt(Math.log(1 + relativeSd ** 2));
  return Math.exp(sigma * normal(random) - sigma ** 2 / 2);
}
export const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
export const sum = values => values.reduce((a, b) => a + b, 0);
export function scope(input) {
  return { business_id: input.business_id, product_id: input.product_id };
}
export function sameScope(a, b) {
  return a.business_id === b.business_id && a.product_id === b.product_id;
}
export function checkStrategy(strategy, input, runId) {
  assert(strategy.run_id === runId, 'Strategy run_id must match the request run_id');
  assert(sameScope(strategy, input), 'Strategy business/product scope does not match input');
  assert(strategy.budget === input.budget && strategy.currency === input.currency, 'Strategy budget/currency must match input');
  assert(strategy.audience === input.audience && strategy.region === input.region, 'Strategy audience/region must match the self-contained task');
  assert(Math.abs(sum(CHANNELS.map(c => strategy.initial_allocation[c])) - 1) < 1e-8, 'Channel allocation fractions must sum to 1');
  assert(CHANNELS.every(c => strategy.initial_allocation[c] >= strategy.adaptation.exploration_floor), 'Initial allocations must preserve the exploration floor');
}
export function checkUniqueStrategies(strategies) {
  assert(new Set(strategies.map(s => `${s.strategy_id}:${s.revision}`)).size === strategies.length, 'Duplicate strategy identifier/revision');
}
