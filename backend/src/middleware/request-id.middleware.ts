import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";

const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const requestId = `req_${randomUUID()}`;

  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  next();
};

export default requestIdMiddleware;
