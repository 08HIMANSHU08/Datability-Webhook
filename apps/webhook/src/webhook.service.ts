import { HttpError } from "../../../libs/common/src/errors";
import type {
  EndpointInput,
  EventInput,
  IWebhookRepository,
} from "./webhook.interface";
import { DeliveryService } from "./delivery.service";

export class WebhookService {
  constructor(
    private readonly repository: IWebhookRepository,
    private readonly delivery: DeliveryService,
  ) {}
  register(input: EndpointInput) {
    return this.repository.createEndpoint(input);
  }
  async accept(input: EventInput) {
    const event = await this.repository.acceptEvent(input);
    await this.delivery.deliver(event);
    return this.get(input.eventId);
  }
  async get(eventId: string) {
    const event = await this.repository.getEvent(eventId);
    if (!event) throw new HttpError(404, "eventId was not found");
    return event;
  }
}
