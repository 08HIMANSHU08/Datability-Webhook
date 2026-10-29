import http from 'node:http';
import https from 'node:https';
import type { EventInput } from '../../../apps/webhook/src/webhook.interface';

export class HttpClientService {
  post(url: string, event: EventInput, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const body = JSON.stringify(event);
      const transport = target.protocol === 'https:' ? https : http;
      const request = transport.request(target, {
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      });
      const timer = setTimeout(() => request.destroy(new Error(`Delivery timed out after ${timeoutMs}ms`)), timeoutMs);
      request.once('response', (response) => {
        clearTimeout(timer);
        const status = response.statusCode ?? 0;
        response.on('error', () => {
        });
        response.destroy();
        resolve(status);
      });
      request.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      request.end(body);
    });
  }
}
