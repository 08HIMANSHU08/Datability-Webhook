import { v7 as uuidv7 } from 'uuid';
import { HttpError } from '../libs/common/src/errors';
import type { Delivery, Endpoint, EndpointInput, EventInput, EventRecord, IWebhookRepository } from '../apps/webhook/src/webhook.interface';

export class MemoryRepository implements IWebhookRepository {
  private endpoints: Endpoint[] = [];
  private events = new Map<string, EventRecord>();
  async createEndpoint(input: EndpointInput): Promise<Endpoint> {
    const endpoint = { ...input, id: uuidv7(), createdAt: new Date().toISOString() };
    this.endpoints.push(endpoint);
    return structuredClone(endpoint);
  }
  async acceptEvent(input: EventInput): Promise<EventRecord> {
    if (this.events.has(input.eventId)) throw new HttpError(409, 'eventId has already been accepted');
    const now = new Date().toISOString();
    const event: EventRecord = {
      ...input,
      createdAt: now,
      deliveries: this.endpoints
        .filter((e) => e.events.includes(input.eventType))
        .map((e) => ({
          id: uuidv7(),
          endpointId: e.id,
          url: e.url,
          status: 'pending',
          attempts: 0,
          lastResponseStatus: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          lastAttemptAt: null,
          completedAt: null,
        })),
    };
    this.events.set(input.eventId, structuredClone(event));
    return structuredClone(event);
  }
  async getEvent(id: string): Promise<EventRecord | null> {
    return structuredClone(this.events.get(id) ?? null);
  }
  async updateDelivery(delivery: Delivery): Promise<void> {
    for (const event of this.events.values()) {
      const index = event.deliveries.findIndex((d) => d.id === delivery.id);
      if (index !== -1) {
        event.deliveries[index] = structuredClone(delivery);
        return;
      }
    }
    throw new Error('Delivery not found');
  }
}
