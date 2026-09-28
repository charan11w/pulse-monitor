import { PORT } from './config/env.js';
import app from './app.js';

const server = app.listen(PORT, () => {
  console.info(JSON.stringify({ event: 'server_started', port: PORT }));
});

server.on('error', () => {
  console.error(JSON.stringify({ event: 'server_start_failed', port: PORT }));
  process.exitCode = 1;
});
