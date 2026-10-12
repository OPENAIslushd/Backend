import { start } from '../shared/http.js';
import { MemoryStore } from './store.js';
const store = new MemoryStore(process.env.MEMORY_DB_PATH ?? '/data/memory.sqlite');
start('memory', request => store.handle(request), () => store.close());
