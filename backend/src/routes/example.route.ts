import { Router } from "express";
import { exampleController } from "../controllers/example.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { exampleSchema } from "../utils/schemas.js";

const router = Router();

router.post("/example", validate(exampleSchema), exampleController);

export default router;
