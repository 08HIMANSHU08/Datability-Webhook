import { Router } from "express";
import { EndpointSchema } from "./schema/endpoint.schema";
import { EventSchema } from "./schema/event.schema";
import { WebhookService } from "./webhook.service";

export class WebhookController {
  readonly router = Router();
  constructor(service: WebhookService) {
    this.router.post("/webhook-endpoints", async (req, res) => {
      const data = await service.register(EndpointSchema.parse(req.body));
      res.status(201).json({ success: true, data });
    });
    this.router.post("/events", async (req, res) => {
      const data = await service.accept(EventSchema.parse(req.body));
      res.status(201).json({ success: true, data });
    });
    this.router.get("/events/:eventId", async (req, res) => {
      const data = await service.get(req.params.eventId);
      res.json({ success: true, data });
    });
  }
}
