import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { validate as validateUuid, version as uuidVersion } from 'uuid';
import { createApp } from '../apps/webhook/src/app';
import type { IWebhookRepository } from '../apps/webhook/src/webhook.interface';

export function webhookContract(label: string, setup: () => Promise<{ repository: IWebhookRepository; cleanup?: () => Promise<void> }>) {
  describe(label, { concurrency: false }, () => {
    let app: ReturnType<typeof createApp>;
    let cleanup: (() => Promise<void>) | undefined;
    let servers: http.Server[];
    let repository: IWebhookRepository;
    const event = { eventId: 'evt_1001', eventType: 'order.created', payload: { orderId: 'order_123', amount: 1500 } };

    beforeEach(async () => {
      servers = [];
      const context = await setup();
      repository = context.repository;
      cleanup = context.cleanup;
      app = createApp(repository, { timeoutMs: 100, maxAttempts: 3, retryDelayMs: 0, concurrency: 10 });
    });
    afterEach(async () => {
      for (const server of servers) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
      await cleanup?.();
    });

    async function endpoint(handler: http.RequestListener) {
      const server = http.createServer(handler);
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
    }
    const register = (url: string, events = ['order.created']) => request(app).post('/webhook-endpoints').send({ url, events });

    it('registers an endpoint and deduplicates subscriptions', async () => {
      const url = await endpoint((_req, res) => res.end());
      const response = await register(url, ['order.created', 'order.created']);
      assert.equal(response.status, 201);
      assert.equal(response.body.data.url, url);
      assert.ok(validateUuid(response.body.data.id));
      assert.equal(uuidVersion(response.body.data.id), 7);
      assert.deepEqual(response.body.data.events, ['order.created']);
    });

    it('rejects unknown endpoint fields without registering an endpoint', async () => {
      let hits = 0;
      const url = await endpoint((_req, res) => { hits++; res.end(); });
      const response = await request(app).post('/webhook-endpoints').send({ url, events: ['order.created'], extra: true });
      assert.equal(response.status, 400);
      assert.match(JSON.stringify(response.body.errors), /extra/);
      const accepted = await request(app).post('/events').send(event);
      assert.equal(accepted.status, 201);
      assert.deepEqual(accepted.body.data.deliveries, []);
      assert.equal(hits, 0);
    });

    it('rejects unknown event fields without accepting the event', async () => {
      const response = await request(app).post('/events').send({ ...event, extra: true });
      assert.equal(response.status, 400);
      assert.match(JSON.stringify(response.body.errors), /extra/);
      assert.equal(await repository.getEvent(event.eventId), null);
      const valid = { ...event, payload: { custom: { arbitrary: true } } };
      const accepted = await request(app).post('/events').send(valid);
      assert.equal(accepted.status, 201);
      assert.deepEqual(accepted.body.data.payload, valid.payload);
    });

    for (const [body, field] of [
      [{ url: 'invalid', events: ['order.created'] }, 'url'],
      [{ url: 'ftp://localhost/test', events: ['order.created'] }, 'url'],
      [{ url: 'http://localhost', events: ['unsupported'] }, 'events.0'],
      [{ url: 'http://localhost', events: [] }, 'events'],
      [{ events: ['order.created'] }, 'url'],
      [{ url: 'http://localhost' }, 'events'],
    ] as const) {
      it(`rejects invalid endpoint input: ${JSON.stringify(body)}`, async () => {
        const response = await request(app).post('/webhook-endpoints').send(body);
        assert.equal(response.status, 400);
        assert.ok(response.body.errors.some((e: { field: string }) => e.field === field));
      });
    }

    for (const body of [
      {},
      { ...event, eventId: '' },
      { ...event, eventId: '   ' },
      { ...event, eventType: 'unknown' },
      { ...event, payload: [] },
      { ...event, payload: null },
      { eventId: 'id', eventType: 'order.created' },
    ]) {
      it(`rejects invalid event input: ${JSON.stringify(body)}`, async () => {
        const response = await request(app).post('/events').send(body);
        assert.equal(response.status, 400);
        assert.ok(response.body.errors.length);
      });
    }

    it('delivers the exact event body and persists success and timestamps', async () => {
      const bodies: unknown[] = [];
      const url = await endpoint((req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          bodies.push(JSON.parse(body));
          res.writeHead(204).end();
        });
      });
      const registered = await register(url);
      const response = await request(app).post('/events').send(event);
      assert.equal(response.status, 201);
      assert.deepEqual(bodies, [event]);
      const delivery = response.body.data.deliveries[0];
      assert.ok(validateUuid(delivery.id));
      assert.equal(uuidVersion(delivery.id), 7);
      assert.equal(delivery.endpointId, registered.body.data.id);
      assert.equal(delivery.url, url);
      assert.equal(delivery.status, 'succeeded');
      assert.equal(delivery.attempts, 1);
      assert.equal(delivery.lastResponseStatus, 204);
      assert.equal(delivery.lastError, null);
      for (const key of ['createdAt', 'updatedAt', 'lastAttemptAt', 'completedAt']) assert.ok(delivery[key]);
      const found = await request(app).get(`/events/${event.eventId}`);
      assert.equal(found.status, 200);
      assert.deepEqual(found.body.data, response.body.data);
    });

    it('rejects sequential duplicates without redelivery', async () => {
      let hits = 0;
      await register(
        await endpoint((_req, res) => {
          hits++;
          res.end();
        }),
      );
      assert.equal((await request(app).post('/events').send(event)).status, 201);
      assert.equal(
        (
          await request(app)
            .post('/events')
            .send({ ...event, payload: { changed: true } })
        ).status,
        409,
      );
      assert.equal(hits, 1);
      assert.deepEqual((await repository.getEvent(event.eventId))?.payload, event.payload);
    });

    it('accepts exactly one of ten concurrent duplicates and delivers once', async () => {
      let hits = 0;
      await register(
        await endpoint((_req, res) => {
          hits++;
          res.end();
        }),
      );
      const responses = await Promise.all(Array.from({ length: 10 }, () => request(app).post('/events').send(event)));
      assert.equal(responses.filter((r) => r.status === 201).length, 1);
      assert.equal(responses.filter((r) => r.status === 409).length, 9);
      assert.equal(hits, 1);
      assert.equal((await repository.getEvent(event.eventId))?.deliveries.length, 1);
    });

    it('stops after three failing attempts and persists failure', async () => {
      let hits = 0;
      await register(
        await endpoint((_req, res) => {
          hits++;
          res.writeHead(503).end();
        }),
      );
      const response = await request(app).post('/events').send(event);
      assert.equal(response.status, 201);
      assert.equal(hits, 3);
      const delivery = response.body.data.deliveries[0];
      assert.equal(delivery.status, 'failed');
      assert.equal(delivery.attempts, 3);
      assert.equal(delivery.lastResponseStatus, 503);
      assert.equal(delivery.lastError, 'HTTP 503');
      assert.ok(delivery.completedAt);
    });

    it('times out an unresponsive endpoint while a healthy endpoint succeeds', async () => {
      let slowHits = 0;
      await register(
        await endpoint(() => {
          slowHits++;
        }),
      );
      const healthy = await register(await endpoint((_req, res) => res.end()));
      const started = Date.now();
      const response = await request(app).post('/events').send(event);
      assert.equal(response.status, 201);
      assert.ok(Date.now() - started < 3000);
      assert.equal(slowHits, 3);
      const failed = response.body.data.deliveries.find((d: { status: string }) => d.status === 'failed');
      assert.equal(failed.attempts, 3);
      assert.match(failed.lastError, /timed out/);
      assert.equal(failed.lastResponseStatus, null);
      const successful = response.body.data.deliveries.find((d: { endpointId: string }) => d.endpointId === healthy.body.data.id);
      assert.equal(successful.status, 'succeeded');
      assert.ok(new Date(successful.completedAt).getTime() < new Date(failed.completedAt).getTime());
    });

    it('recovers after an initial failed attempt', async () => {
      let hits = 0;
      await register(
        await endpoint((_req, res) => {
          res.writeHead(++hits === 1 ? 500 : 200).end();
        }),
      );
      const response = await request(app).post('/events').send(event);
      assert.equal(response.body.data.deliveries[0].status, 'succeeded');
      assert.equal(response.body.data.deliveries[0].attempts, 2);
      assert.equal(response.body.data.deliveries[0].lastError, null);
    });

    it('handles a dropped connection without crashing', async () => {
      await register(await endpoint((req) => req.socket.destroy()));
      const response = await request(app).post('/events').send(event);
      assert.equal(response.status, 201);
      assert.equal(response.body.data.deliveries[0].status, 'failed');
      assert.equal(response.body.data.deliveries[0].attempts, 3);
      assert.ok(response.body.data.deliveries[0].lastError);
    });

    it('does not follow redirects', async () => {
      let redirectedHits = 0;
      const target = await endpoint((_req, res) => {
        redirectedHits++;
        res.end();
      });
      await register(await endpoint((_req, res) => res.writeHead(302, { Location: target }).end()));
      const response = await request(app).post('/events').send(event);
      assert.equal(response.body.data.deliveries[0].lastResponseStatus, 302);
      assert.equal(response.body.data.deliveries[0].status, 'failed');
      assert.equal(redirectedHits, 0);
    });

    it('accepts with no subscriptions and excludes unrelated subscriptions', async () => {
      let hits = 0;
      await register(
        await endpoint((_req, res) => {
          hits++;
          res.end();
        }),
        ['payment.failed'],
      );
      const response = await request(app).post('/events').send(event);
      assert.equal(response.status, 201);
      assert.deepEqual(response.body.data.deliveries, []);
      assert.equal(hits, 0);
    });

    it('returns 404 for an unknown event', async () => {
      assert.equal((await request(app).get('/events/unknown')).status, 404);
    });

    it('rejects malformed JSON', async () => {
      const response = await request(app).post('/events').set('Content-Type', 'application/json').send('{');
      assert.equal(response.status, 400);
      assert.match(response.body.message, /JSON/);
    });

    it('honors a lower configured attempt limit', async () => {
      app = createApp(repository, { timeoutMs: 100, maxAttempts: 1, retryDelayMs: 0, concurrency: 2 });
      let hits = 0;
      await register(
        await endpoint((_req, res) => {
          hits++;
          res.writeHead(400).end();
        }),
      );
      const response = await request(app).post('/events').send(event);
      assert.equal(hits, 1);
      assert.equal(response.body.data.deliveries[0].attempts, 1);
      assert.equal(response.body.data.deliveries[0].status, 'failed');
    });
  });
}
