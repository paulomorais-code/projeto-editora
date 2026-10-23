import { afterEach, describe, expect, it } from "vitest";
import {
  adminBlockedSeconds,
  clearAdminFailures,
  registerAdminFailure,
  resetAdminAttempts,
} from "./admin-auth.js";

describe("admin brute-force guard", () => {
  afterEach(() => resetAdminAttempts());

  it("blocks the IP after 5 failures and reports remaining seconds", () => {
    for (let i = 0; i < 5; i += 1) registerAdminFailure("1.2.3.4");
    const blocked = adminBlockedSeconds("1.2.3.4");
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThanOrEqual(15 * 60);
  });

  it("does not block other IPs", () => {
    for (let i = 0; i < 5; i += 1) registerAdminFailure("1.2.3.4");
    expect(adminBlockedSeconds("5.6.7.8")).toBe(0);
  });

  it("clears failures after a successful login", () => {
    for (let i = 0; i < 4; i += 1) registerAdminFailure("1.2.3.4");
    clearAdminFailures("1.2.3.4");
    for (let i = 0; i < 4; i += 1) registerAdminFailure("1.2.3.4");
    expect(adminBlockedSeconds("1.2.3.4")).toBe(0);
  });

  it("keeps counting failures below the threshold", () => {
    for (let i = 0; i < 4; i += 1) registerAdminFailure("1.2.3.4");
    expect(adminBlockedSeconds("1.2.3.4")).toBe(0);
  });
});
