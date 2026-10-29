import { logger } from "../../../libs/common/src/logger";
import { setTimeout as delay } from "node:timers/promises";
import type { DeliveryConfig } from "../../../libs/common/src/config";
import { HttpClientService } from "../../../libs/http-client/src/http-client.service";
import type {
  Delivery,
  EventInput,
  EventRecord,
  IWebhookRepository,
} from "./webhook.interface";

export class DeliveryService {
  constructor(
    private readonly repository: IWebhookRepository,
    private readonly settings: DeliveryConfig,
    private readonly httpClient = new HttpClientService(),
  ) {
    if (
      !Number.isInteger(settings.maxAttempts) ||
      settings.maxAttempts < 1 ||
      settings.maxAttempts > 3 ||
      !Number.isInteger(settings.concurrency) ||
      settings.concurrency < 1 ||
      settings.concurrency > 100 ||
      !Number.isInteger(settings.timeoutMs) ||
      settings.timeoutMs < 1 ||
      settings.timeoutMs > 60000 ||
      !Number.isInteger(settings.retryDelayMs) ||
      settings.retryDelayMs < 0 ||
      settings.retryDelayMs > 60000
    )
      throw new Error("Invalid delivery settings");
  }

  async deliver(event: EventRecord): Promise<void> {
    let index = 0;
    const errors: unknown[] = [];
    const tasks = Array.from(
      { length: Math.min(this.settings.concurrency, event.deliveries.length) },
      async () => {
        while (index < event.deliveries.length) {
          const delivery = event.deliveries[index++];
          try {
            await this.deliverToEndpoint(event, delivery);
          } catch (error) {
            errors.push(error);
          }
        }
      },
    );
    await Promise.all(tasks);
    if (errors.length) throw errors[0];
  }

  private async deliverToEndpoint(
    event: EventInput,
    delivery: Delivery,
  ): Promise<void> {
    const body: EventInput = {
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload,
    };
    for (let attempt = 1; attempt <= this.settings.maxAttempts; attempt++) {
      delivery.status = "delivering";
      delivery.attempts = attempt;
      delivery.lastAttemptAt = delivery.updatedAt = new Date().toISOString();
      await this.repository.updateDelivery(delivery);
      try {
        delivery.lastResponseStatus = await this.httpClient.post(
          delivery.url,
          body,
          this.settings.timeoutMs,
        );
        delivery.lastError =
          delivery.lastResponseStatus >= 200 &&
          delivery.lastResponseStatus < 300
            ? null
            : `HTTP ${delivery.lastResponseStatus}`;
      } catch (error) {
        delivery.lastResponseStatus = null;
        delivery.lastError = (
          error instanceof Error ? error.message : "Network error"
        ).slice(0, 2048);
      }
      const succeeded = delivery.lastError === null;
      delivery.status = succeeded
        ? "succeeded"
        : attempt === this.settings.maxAttempts
          ? "failed"
          : "delivering";
      delivery.updatedAt = new Date().toISOString();
      delivery.completedAt =
        delivery.status === "succeeded" || delivery.status === "failed"
          ? delivery.updatedAt
          : null;
      await this.repository.updateDelivery(delivery);
      const fields = {
        eventId: event.eventId,
        deliveryId: delivery.id,
        endpointId: delivery.endpointId,
        attempt,
        status: delivery.status,
        responseStatus: delivery.lastResponseStatus,
      };
      if (succeeded) logger.info("Webhook delivery succeeded", fields);
      else logger.warn("Webhook delivery attempt failed", fields);
      if (succeeded) return;
      if (attempt < this.settings.maxAttempts && this.settings.retryDelayMs > 0)
        await delay(this.settings.retryDelayMs);
    }
  }
}
