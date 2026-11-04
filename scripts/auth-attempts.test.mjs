import assert from "node:assert/strict";
import test from "node:test";
import { authAttemptKey, boundedAuthText, createAuthAttemptLimiter } from "../server/auth-attempts.mjs";

test("1E: clés et entrées auth bornées sans conserver les valeurs excessives", () => {
  const key = authAttemptKey("I".repeat(65536), "A".repeat(65536));
  assert.equal(key, "invalid-ip:invalid-code");
  assert.equal(boundedAuthText("a".repeat(513), 512), null);
  assert.equal(boundedAuthText("a".repeat(512), 512)?.length, 512);
  assert.equal(boundedAuthText("A".repeat(64), 64)?.length, 64);
  assert.equal(boundedAuthText({}, 64), null);
  assert.equal(authAttemptKey("203.0.113.7", " test "), "203.0.113.7:TEST");
});

test("1E: cardinalité bornée, purge, compartiment de débordement et blocages conservés", () => {
  let time = 0;
  const limiter = createAuthAttemptLimiter({ windowMs: 100, maxAttempts: 2, maxEntries: 3, now: () => time });
  limiter.register("blocked"); limiter.register("blocked");
  limiter.register("a"); limiter.register("b");
  assert.equal(limiter.size, 3);
  for (let index = 0; index < 20; index++) limiter.register(`overflow-${index}`);
  assert.equal(limiter.size, 3);
  assert.equal(limiter.isLimited("blocked"), true, "No eviction of existing protected counters");
  assert.equal(limiter.isLimited("another-new-key"), true);
  limiter.clear("a");
  limiter.register("new");
  assert.equal(limiter.size, 3);
  time = 101;
  assert.equal(limiter.size, 0);
  assert.equal(limiter.isLimited("another-new-key"), false);
  limiter.register("after-expiry");
  assert.equal(limiter.size, 1);
});
