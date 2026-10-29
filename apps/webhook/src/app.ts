import { logger } from '../../../libs/common/src/logger';
import { v7 as uuidv7 } from 'uuid';
import express from 'express';
import type { DeliveryConfig } from '../../../libs/common/src/config';
import { errorHandler } from '../../../libs/common/src/errors';
import type { IWebhookRepository } from './webhook.interface';
import { createWebhookModule } from './webhook.module';

export function createApp(repository: IWebhookRepository, settings: DeliveryConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const requestId = uuidv7();
    const startedAt = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    res.on('finish', () => {
      const fields = { requestId, method: req.method, route: req.route?.path ?? 'unmatched', statusCode: res.statusCode, durationMs: Math.round(performance.now() - startedAt) };
      if (res.statusCode >= 500) logger.error('HTTP request completed', fields);
      else if (res.statusCode >= 400) logger.warn('HTTP request completed', fields);
      else logger.info('HTTP request completed', fields);
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(createWebhookModule(repository, settings));
  app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
  });
  app.use(errorHandler);
  return app;
}
