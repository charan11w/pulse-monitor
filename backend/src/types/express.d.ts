declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { user: { id: string; name: string; email: string }; tokenHash: string };
    }
  }
}

export {};
