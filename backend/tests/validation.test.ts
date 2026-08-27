import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("POST /example", () => {
  it("should accept valid data", async () => {
    const response = await request(app).post("/example").send({
      name: "Charan",
      age: 25,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should reject invalid data", async () => {
    const response = await request(app).post("/example").send({
      name: 123,
      age: "hello",
    });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.requestId).toBeDefined();
  });
});
