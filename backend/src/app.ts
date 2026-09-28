import express, { Router } from 'express';
import { database } from './config/database.js';
import { FRONTEND_ORIGIN, NODE_ENV } from './config/env.js';
import { createAuthRoutes } from './routes/auth.route.js';
import { createProjectRoutes } from './routes/project.route.js';
import { createTelemetryRoutes } from './routes/telemetry.route.js';
import { getTelemetryQueue } from './telemetry/queue.js';
import healthRoutes from './routes/health.route.js';
import requestIdMiddleware from './middleware/request-id.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';

const apiRoutes = Router();
apiRoutes.use(healthRoutes);
apiRoutes.use('/api/v1/auth', createAuthRoutes(database, FRONTEND_ORIGIN, NODE_ENV === 'production'));
apiRoutes.use('/api/v1/projects', createProjectRoutes(database, FRONTEND_ORIGIN));
apiRoutes.use('/api/v1/telemetry', createTelemetryRoutes(database, data => getTelemetryQueue().enqueue(data)));

export function createApp(routes: Router = apiRoutes) {
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
