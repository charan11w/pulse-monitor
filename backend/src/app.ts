import express from 'express';
import healthRoutes from './routes/health.route.js';
import requestIdMiddleware from './middleware/request-id.middleware.js';
import { ErrorMiddleWare } from './middleware/error.middleware.js';
import {NotFoundMiddleware} from './middleware/not-found.middleware.js'
import exampleRoute from './routes/example.route.js'

const app=express();

app.use(express.json());
app.use(requestIdMiddleware);
app.use(healthRoutes);
app.use(exampleRoute);

app.use(NotFoundMiddleware);
app.use(ErrorMiddleWare);

export default app;