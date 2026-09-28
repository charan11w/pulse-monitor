import dotenv from 'dotenv';
import { parseEnv } from './env-schema.js';

dotenv.config({ quiet: true });

export const { PORT, NODE_ENV, FRONTEND_ORIGIN } = parseEnv(process.env);
