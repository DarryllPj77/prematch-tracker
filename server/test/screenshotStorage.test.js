import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createScreenshotStorage } from "../src/screenshotStorage.js";

describe("team-scoped screenshot object storage", () => {
  test("uploads, downloads, and deletes private proof objects", async () => {
    const commands = [];
    const client = {
      async send(command) {
        commands.push(command);
        if (command.constructor.name === "GetObjectCommand") {
          return {
            ContentType: "image/png",
            Body: { async transformToByteArray() { return Uint8Array.from([1, 2, 3]); } },
          };
        }
        return {};
      },
    };
    const storage = createScreenshotStorage({ client, env: { SCREENSHOT_BUCKET: "proofs" } });
    const profile = { id: 12, role: "player", teamCode: "K9X2" };

    const key = await storage.upload({
      profile,
      body: Buffer.from([1, 2, 3]),
      contentType: "image/png",
      capturedFor: "dm-1",
    });
    assert.match(key, /^remote:teams\/K9X2\/players\/12\/.+\.png$/);
    assert.equal(commands[0].input.Bucket, "proofs");
    assert.equal(commands[0].input.ContentType, "image/png");

    const downloaded = await storage.download({ profile, screenshotKey: key });
    assert.deepEqual(downloaded.body, Buffer.from([1, 2, 3]));
    assert.equal(downloaded.contentType, "image/png");

    assert.equal(await storage.deleteOne({ profile, screenshotKey: key }), true);

    assert.equal(await storage.deleteMany("K9X2", [key, "shot:legacy"]), 1);
    assert.equal(commands[3].input.Delete.Objects.length, 1);
  });

  test("rejects cross-team reads and unsupported files", async () => {
    const storage = createScreenshotStorage({ client: { send: async () => ({}) } });
    await assert.rejects(
      storage.download({
        profile: { id: 1, role: "player", teamCode: "K9X2" },
        screenshotKey: "remote:teams/R4V4/players/2/proof.png",
      }),
      (error) => error.code === "SCREENSHOT_FORBIDDEN",
    );
    await assert.rejects(
      storage.download({
        profile: { id: 1, role: "player", teamCode: "K9X2" },
        screenshotKey: "remote:teams/K9X2/players/2/proof.png",
      }),
      (error) => error.code === "SCREENSHOT_FORBIDDEN",
    );
    await assert.rejects(
      storage.upload({
        profile: { id: 1, teamCode: "K9X2" },
        body: Buffer.from("unsafe"),
        contentType: "image/svg+xml",
      }),
      (error) => error.code === "INVALID_SCREENSHOT_TYPE",
    );
  });
});
