import express, { type Router } from 'express';
import healthRoutes from './routes/health.route.js';
import requestIdMiddleware from './middleware/request-id.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';

export function createApp(routes: Router = healthRoutes) {
  const app = express();
  app.disable('x-powered-by');

  // Rejected bodies also need request IDs and logs.
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(express.json({ limit: '100kb' }));
  app.use(routes);
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

export default createApp();
