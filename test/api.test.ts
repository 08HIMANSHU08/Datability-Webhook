import { webhookContract } from './contract';
import { MemoryRepository } from './memory.repository';
webhookContract('API and delivery contract (test repository)', async () => ({ repository: new MemoryRepository() }));
