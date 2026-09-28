import '../config/env.js';
import { runTraffic } from './traffic.js';

runTraffic(`http://127.0.0.1:${process.env.DEMO_PORT ?? 4000}`, Number(process.env.DEMO_REQUESTS ?? 30))
  .then(result => console.info(JSON.stringify({ event: 'traffic_finished', ...result })))
  .catch(() => { console.error('Demo traffic failed. Check the local demo API and DEMO_REQUESTS.'); process.exitCode = 1; });
