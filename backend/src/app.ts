import express from 'express';
import healthRoutes from './routes/health.route.js';
import requestIdMiddleware from './middleware/request-id.middleware.js';

const app=express();

app.use(express.json());
app.use(requestIdMiddleware);
app.use(healthRoutes);

export default app;