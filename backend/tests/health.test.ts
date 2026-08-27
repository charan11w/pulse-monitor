import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("GET /health", () => {
  it("should return a healthy response", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("should return a request ID", async () => {
    const response = await request(app).get("/health");

    expect(response.headers["x-request-id"]).toBeDefined();
  });
});
