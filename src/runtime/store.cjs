const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AppError } = require("./core.cjs");
class Store {
  constructor(root) {
    this.root = path.resolve(root);
    this.queues = new Map();
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    // A process lock prevents two servers from corrupting JSON indexes. Stale locks are reclaimed.
    const lock = path.join(this.root, ".writer.lock");
    try {
      this.lock = await fs.open(lock, "wx", 0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = Number(await fs.readFile(lock, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error("Invalid writer lock; inspect data/.writer.lock");
      try {
        process.kill(pid, 0);
        throw new Error("DATA_DIR already has an active writer");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
      await fs.unlink(lock);
      this.lock = await fs.open(lock, "wx", 0o600);
    }
    await this.lock.writeFile(String(process.pid));
  }
  async close() {
    if (this.lock) {
      await this.lock.close();
      await fs.unlink(path.join(this.root, ".writer.lock"));
      this.lock = null;
    }
  }
  async serial(key, fn) {
    const prior = this.queues.get(key) || Promise.resolve();
    const job = prior.catch(() => {}).then(fn);
    this.queues.set(key, job);
    try {
      return await job;
    } finally {
      if (this.queues.get(key) === job) this.queues.delete(key);
    }
  }
  async list(dir) {
    try {
      return (await fs.readdir(path.join(this.root, dir))).filter((x) =>
        x.endsWith(".json"),
      );
    } catch (e) {
      if (e.code === "ENOENT") return [];
      throw e;
    }
  }
  async read(file) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.root, file), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw new AppError("STORAGE_FAILED", "JSON kaydı okunamadı.", 500);
    }
  }
  async write(file, value) {
    const target = path.join(this.root, file),
      temp = target + "." + randomUUID() + ".tmp";
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, target);
    } catch {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw new AppError("STORAGE_FAILED", "JSON kaydı yazılamadı.", 500, true);
    }
  }
}
module.exports = { Store };
