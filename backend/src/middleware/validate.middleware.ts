import { Request, Response, NextFunction } from "express";
import { ZodType } from "zod";
import { AppError } from "../utils/app-error.js";

export const validate = <T>(schema: ZodType<T>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await schema.safeParseAsync(req.body);

      if (!result.success) {
        return next(
          new AppError("Invalid request data", 400, "VALIDATION_ERROR"),
        );
      }

      req.body = result.data;

      next();
    } catch (error) {
      next(error);
    }
  };
};
