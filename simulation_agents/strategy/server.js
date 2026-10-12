import { start } from '../shared/http.js';
import { generate } from './agent.js';
start('strategy', generate);
