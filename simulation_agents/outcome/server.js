import { start } from '../shared/http.js';
import { handleOutcome } from './agent.js';
start('outcome', handleOutcome);
