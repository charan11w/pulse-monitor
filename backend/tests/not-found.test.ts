import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";

describe("404 handling", () => {
  it("should return an 404 for unknown error", async () => {
    const response = await request(app).get("/does-not-exist");

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toBeDefined();
  });
});
