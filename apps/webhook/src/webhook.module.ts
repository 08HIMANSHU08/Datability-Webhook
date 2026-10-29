import type { DeliveryConfig } from "../../../libs/common/src/config";
import type { IWebhookRepository } from "./webhook.interface";
import { DeliveryService } from "./delivery.service";
import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

export function createWebhookModule(
  repository: IWebhookRepository,
  config: DeliveryConfig,
) {
  const delivery = new DeliveryService(repository, config);
  const service = new WebhookService(repository, delivery);
  return new WebhookController(service).router;
}
