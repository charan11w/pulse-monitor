export function onShutdown(close: () => Promise<void>) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      console.error(JSON.stringify({ event: 'shutdown_deadline_exceeded' }));
      process.exit(1);
    }, 10000);
    deadline.unref();
    try { await close(); clearTimeout(deadline); }
    catch { console.error(JSON.stringify({ event: 'shutdown_failed' })); process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // Parent-controlled demo/tests use IPC; Windows cannot reliably send POSIX signals.
  process.on('message', message => { if (message === 'shutdown') void stop().then(() => process.disconnect?.()); });
}
