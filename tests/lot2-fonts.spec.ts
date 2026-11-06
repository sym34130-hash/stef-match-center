import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("Lot 2 : polices locales réellement rendues par Express avec CSP restrictive", async ({ page, request }, info) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "stef-lot2-fonts-"));
  await mkdir(path.join(temporary, "058"));
  for (const file of ["latest.json", "latest.xlsx"]) await copyFile(path.join("data/agencies/058", file), path.join(temporary, "058", file));
  const port = await new Promise<number>(resolve => {
    const socket = createServer();
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") throw new Error("Port local absent");
      socket.close(() => resolve(address.port));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server/index.mjs"], { env: { ...process.env,
    NODE_ENV: "production", PORT: String(port), STEF_BIND_HOST: "127.0.0.1", STEF_DATA_DIR: temporary,
    STEF_AGENCIES_JSON: JSON.stringify([{ code: "058", name: "Test local", accessCode: "font-test-only", canImport: false }]),
  }, stdio: "ignore" });
  try {
    await expect.poll(async () => { try { return (await request.get(`${base}/api/health`)).status(); } catch { return 0; } }).toBe(200);
    const errors: string[] = [];
    const externalFonts: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", r => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) externalFonts.push(r.url()); });
    const response = await page.goto(base);
    expect(response?.headers()["content-security-policy"]).toContain("font-src 'self'");
    await page.getByLabel("Code agence").selectOption("058");
    await page.getByLabel("Code d'accès").fill("font-test-only");
    await page.getByRole("button", { name: "Accéder au match" }).click();
    await page.getByRole("button", { name: "ADM Administrateur", exact: true }).click();
    expect(await page.evaluate(async () => {
      const regular = await document.fonts.load('400 24px "Archivo Black"');
      const italic = await document.fonts.load('italic 900 24px "Barlow Condensed"');
      return [regular.length, italic.length];
    })).toEqual([1, 1]);
    for (const file of ["ArchivoBlack-Regular.ttf", "BarlowCondensed-BlackItalic.ttf"]) {
      const asset = await request.get(`${base}/fonts/${file}`);
      expect(asset.status()).toBe(200);
      expect((await asset.body()).length).toBeGreaterThan(10_000);
    }
    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const { root } = await client.send("DOM.getDocument");
    const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".league-card-top strong" });
    const rendered = await client.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(rendered.fonts.some(font => font.isCustomFont && /Archivo Black/i.test(font.familyName))).toBe(true);
    for (const label of await page.locator(".league-card-top strong").all()) {
      expect(await label.evaluate(e => {
        const r = e.getBoundingClientRect(), card = e.closest(".league-card")!.getBoundingClientRect();
        return r.width > 0 && r.left >= card.left && r.right <= card.right && r.top >= card.top && r.bottom <= card.bottom;
      })).toBe(true);
    }
    expect(externalFonts).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("express-leagues.png"), fullPage: true });
    await info.attach("polices-rendues.json", { body: JSON.stringify(rendered, null, 2), contentType: "application/json" });
  } finally {
    if (server.exitCode === null) { const closed = once(server, "close"); server.kill("SIGTERM"); await closed; }
    await rm(temporary, { recursive: true, force: true });
  }
});
