export const EVENT_TYPES = [
  "order.created",
  "order.updated",
  "order.cancelled",
  "payment.succeeded",
  "payment.failed",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export interface EndpointInput {
  url: string;
  events: EventType[];
}
export interface Endpoint extends EndpointInput {
  id: string;
  createdAt: string;
}
export interface EventInput {
  eventId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
}
export const DELIVERY_STATUSES = [
  "pending",
  "delivering",
  "succeeded",
  "failed",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export interface Delivery {
  id: string;
  endpointId: string;
  url: string;
  status: DeliveryStatus;
  attempts: number;
  lastResponseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  completedAt: string | null;
}
export interface EventRecord extends EventInput {
  createdAt: string;
  deliveries: Delivery[];
}
export interface IWebhookRepository {
  createEndpoint(input: EndpointInput): Promise<Endpoint>;
  acceptEvent(input: EventInput): Promise<EventRecord>;
  getEvent(eventId: string): Promise<EventRecord | null>;
  updateDelivery(delivery: Delivery): Promise<void>;
}
