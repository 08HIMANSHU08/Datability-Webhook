import { logger } from './logger';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, message: 'Validation failed', errors: error.issues.map((issue) => ({ field: issue.path.join('.') || 'body', message: issue.message })) });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ success: false, message: error.message });
    return;
  }
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ success: false, message: error.type === 'entity.too.large' ? 'body exceeds 1 MB' : 'body must contain valid JSON' });
    return;
  }
  logger.error('Request failed', { requestId: res.locals.requestId, errorType: error instanceof Error ? error.name : 'UnknownError' });
  res.status(500).json({ success: false, message: 'Internal server error' });
};
