import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

export const errorMiddleware: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  let status = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'Internal Server Error';

  if (error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
  } else if (error instanceof Error && 'type' in error) {
    // Parser errors can contain raw bodies. Never echo or log that object.
    switch (error.type) {
      case 'entity.parse.failed':
        status = 400;
        code = 'INVALID_JSON';
        message = 'Request body must be valid JSON';
        break;
      case 'entity.too.large':
        status = 413;
        code = 'PAYLOAD_TOO_LARGE';
        message = 'Request body exceeds the 100kb limit';
        break;
      case 'charset.unsupported':
      case 'encoding.unsupported':
        status = 415;
        code = 'UNSUPPORTED_ENCODING';
        message = 'Unsupported request encoding';
        break;
    }
  }

  if (status >= 500) {
    console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId, code }));
  }

  res.status(status).json({
    success: false,
    error: { code, message, requestId: req.requestId },
  });
};
