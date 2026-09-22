import dotenv from 'dotenv';
import { parseEnv } from './env-schema.js';

dotenv.config({ quiet: true });

export const { PORT, NODE_ENV } = parseEnv(process.env);
