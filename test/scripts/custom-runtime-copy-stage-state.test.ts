import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const script = path.resolve("scripts/custom-runtime/copy_stage_state.py");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("custom runtime staging state copy", () => {
  it("does not replicate immutable governance source capsules into disposable state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-stage-governance-capsules-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    const capsule = path.join(
      source,
      "pcc",
      "release-governance",
      "control-director-composite-v1",
      "source-capsules",
      "source-capsule-test",
      "base-source.tar",
    );
    fs.mkdirSync(path.dirname(capsule), { recursive: true });
    fs.writeFileSync(capsule, Buffer.alloc(1024, 7));
    fs.mkdirSync(path.join(source, "pcc", "release-governance"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "pcc", "release-governance", "status.json"),
      '{"ready":true}\n',
      "utf8",
    );

    const result = spawnSync("python3", [script, source, target], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(target, "pcc", "release-governance", "status.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          target,
          "pcc",
          "release-governance",
          "control-director-composite-v1",
          "source-capsules",
          "source-capsule-test",
          "base-source.tar",
        ),
      ),
    ).toBe(false);
  });

  it("backs up live WAL databases consistently and excludes transient state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-stage-state-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    const databasePath = path.join(source, "state", "openclaw.sqlite");
    const harnessDatabasePath = path.join(
      source,
      "agents",
      "main",
      "agent",
      "codex-home",
      "logs_2.sqlite",
    );
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(path.dirname(harnessDatabasePath), { recursive: true });
    fs.mkdirSync(path.join(source, "logs"), { recursive: true });
    fs.writeFileSync(path.join(source, "settings.json"), '{"ready":true}\n', "utf8");
    fs.writeFileSync(path.join(source, "logs", "gateway.log"), "secret-free test log\n", "utf8");

    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA journal_mode=WAL");
    database.exec("PRAGMA wal_autocheckpoint=0");
    database.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    database.prepare("INSERT INTO evidence(value) VALUES (?)").run("committed-in-wal");
    expect(fs.existsSync(`${databasePath}-wal`)).toBe(true);
    const harnessDatabase = new DatabaseSync(harnessDatabasePath);
    harnessDatabase.exec("CREATE TABLE events (id INTEGER PRIMARY KEY)");
    harnessDatabase.close();

    const result = spawnSync("python3", [script, source, target], { encoding: "utf8" });
    database.close();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      databaseCount: 1,
      databases: ["state/openclaw.sqlite"],
      excludedDatabaseCount: 1,
      excludedDatabases: ["agents/main/agent/codex-home/logs_2.sqlite"],
    });
    expect(fs.readFileSync(path.join(target, "settings.json"), "utf8")).toBe('{"ready":true}\n');
    expect(fs.existsSync(path.join(target, "logs"))).toBe(false);
    expect(fs.existsSync(path.join(target, "state", "openclaw.sqlite-wal"))).toBe(false);
    expect(fs.existsSync(path.join(target, "state", "openclaw.sqlite-shm"))).toBe(false);
    expect(fs.existsSync(path.join(target, "agents", "main", "agent", "codex-home"))).toBe(false);

    const copied = new DatabaseSync(path.join(target, "state", "openclaw.sqlite"), {
      readOnly: true,
    });
    expect(copied.prepare("SELECT value FROM evidence").get()).toEqual({
      value: "committed-in-wal",
    });
    expect(copied.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(copied.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" });
    copied.close();
  });

  it("fails closed when the destination contains stale state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-stage-state-stale-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "stale.json"), "{}\n", "utf8");

    const result = spawnSync("python3", [script, source, target], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stage target directory must be empty");
    expect(fs.readFileSync(path.join(target, "stale.json"), "utf8")).toBe("{}\n");
  });

  it("remaps copied plugin install paths without changing external artifact sources", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-stage-plugin-paths-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    const databasePath = path.join(source, "state", "openclaw.sqlite");
    const legacyPath = path.join(source, "plugins", "installs.json");
    const sourceInstallPath = path.join(source, "npm", "projects", "demo", "node_modules", "demo");
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.mkdirSync(sourceInstallPath, { recursive: true });

    const legacy = {
      installRecords: {
        demo: {
          source: "npm",
          sourcePath: "/private/tmp/demo.tgz",
          installPath: sourceInstallPath,
        },
      },
    };
    fs.writeFileSync(legacyPath, `${JSON.stringify(legacy)}\n`, "utf8");

    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE installed_plugin_index (
        index_key TEXT PRIMARY KEY,
        install_records_json TEXT NOT NULL,
        plugins_json TEXT NOT NULL
      )
    `);
    database
      .prepare(
        "INSERT INTO installed_plugin_index(index_key, install_records_json, plugins_json) VALUES (?, ?, ?)",
      )
      .run(
        "installed-plugin-index",
        JSON.stringify(legacy.installRecords),
        JSON.stringify({ demo: { rootDir: sourceInstallPath } }),
      );
    database.close();

    const result = spawnSync("python3", [script, source, target], { encoding: "utf8" });

    expect(result.status).toBe(0);
    const expectedInstallPath = path.join(
      fs.realpathSync(target),
      "npm",
      "projects",
      "demo",
      "node_modules",
      "demo",
    );
    const copiedLegacy = JSON.parse(
      fs.readFileSync(path.join(target, "plugins", "installs.json"), "utf8"),
    ) as typeof legacy;
    expect(copiedLegacy.installRecords.demo).toEqual({
      source: "npm",
      sourcePath: "/private/tmp/demo.tgz",
      installPath: expectedInstallPath,
    });

    const copiedDatabase = new DatabaseSync(path.join(target, "state", "openclaw.sqlite"), {
      readOnly: true,
    });
    const copiedRow = copiedDatabase
      .prepare(
        "SELECT install_records_json, plugins_json FROM installed_plugin_index WHERE index_key = ?",
      )
      .get("installed-plugin-index") as {
      install_records_json: string;
      plugins_json: string;
    };
    expect(JSON.parse(copiedRow.install_records_json)).toEqual({
      demo: {
        source: "npm",
        sourcePath: "/private/tmp/demo.tgz",
        installPath: expectedInstallPath,
      },
    });
    expect(JSON.parse(copiedRow.plugins_json)).toEqual({
      demo: { rootDir: expectedInstallPath },
    });
    expect(copiedDatabase.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    copiedDatabase.close();
  });

  it("fails closed when source and destination overlap", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-stage-state-overlap-"));
    temporaryDirectories.push(root);
    const source = path.join(root, "source");
    const target = path.join(source, "candidate");
    fs.mkdirSync(source, { recursive: true });

    const result = spawnSync("python3", [script, source, target], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stage source and target directories must not overlap");
  });
});
