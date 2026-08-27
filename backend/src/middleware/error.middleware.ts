import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/app-error.js";

export const ErrorMiddleWare = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  void next;

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        requestId: req.requestId,
      },
    });
  }

  console.error(error);
  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal Server Error",
      requestId: req.requestId,
    },
  });
};
