import { v7 as uuidv7 } from "uuid";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { HttpError } from "../../../libs/common/src/errors";
import type {
  Delivery,
  Endpoint,
  EndpointInput,
  EventInput,
  EventRecord,
  IWebhookRepository,
} from "./webhook.interface";

export class WebhookRepository implements IWebhookRepository {
  constructor(private readonly pool: Pool) {}

  async createEndpoint(input: EndpointInput): Promise<Endpoint> {
    const connection = await this.pool.getConnection();
    const endpoint = {
      ...input,
      id: uuidv7(),
      createdAt: new Date().toISOString(),
    };
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO webhook_endpoints (id,url,created_at) VALUES (?,?,?)",
        [endpoint.id, endpoint.url, new Date(endpoint.createdAt)],
      );
      for (const type of input.events)
        await connection.execute(
          "INSERT INTO endpoint_subscriptions (endpoint_id,event_type) VALUES (?,?)",
          [endpoint.id, type],
        );
      await connection.commit();
      return endpoint;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async acceptEvent(input: EventInput): Promise<EventRecord> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      try {
        await connection.execute(
          "INSERT INTO events (event_id,event_type,payload) VALUES (?,?,?)",
          [input.eventId, input.eventType, JSON.stringify(input.payload)],
        );
      } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY")
          throw new HttpError(409, "eventId has already been accepted");
        throw error;
      }
      const [endpoints] = await connection.execute<RowDataPacket[]>(
        "SELECT e.id,e.url FROM endpoint_subscriptions s JOIN webhook_endpoints e ON e.id=s.endpoint_id WHERE s.event_type=?",
        [input.eventType],
      );
      for (const endpoint of endpoints) {
        await connection.execute(
          "INSERT INTO deliveries (id,event_id,endpoint_id,url) VALUES (?,?,?,?)",
          [uuidv7(), input.eventId, endpoint.id, endpoint.url],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return (await this.getEvent(input.eventId))!;
  }

  async getEvent(eventId: string): Promise<EventRecord | null> {
    const [events] = await this.pool.execute<RowDataPacket[]>(
      "SELECT event_id AS eventId,event_type AS eventType,payload,created_at AS createdAt FROM events WHERE event_id=?",
      [eventId],
    );
    if (!events[0]) return null;
    const [deliveries] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id,endpoint_id AS endpointId,url,status,attempts,last_response_status AS lastResponseStatus,last_error AS lastError,
      created_at AS createdAt,updated_at AS updatedAt,last_attempt_at AS lastAttemptAt,completed_at AS completedAt
      FROM deliveries WHERE event_id=? ORDER BY created_at,id`,
      [eventId],
    );
    const event = events[0];
    return {
      ...event,
      payload:
        typeof event.payload === "string"
          ? JSON.parse(event.payload)
          : event.payload,
      deliveries,
    } as EventRecord;
  }

  async updateDelivery(delivery: Delivery): Promise<void> {
    await this.pool.execute(
      `UPDATE deliveries SET status=?,attempts=?,last_response_status=?,last_error=?,updated_at=?,last_attempt_at=?,completed_at=? WHERE id=?`,
      [
        delivery.status,
        delivery.attempts,
        delivery.lastResponseStatus,
        delivery.lastError,
        new Date(delivery.updatedAt),
        delivery.lastAttemptAt ? new Date(delivery.lastAttemptAt) : null,
        delivery.completedAt ? new Date(delivery.completedAt) : null,
        delivery.id,
      ],
    );
  }
}
