import { start } from '../shared/http.js';
import { evaluate } from './agent.js';
start('simulation', evaluate);
