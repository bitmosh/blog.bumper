import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// Hoist mock so runner.ts and enroll.ts see it at import time
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
}));

import * as inquirer from "@inquirer/prompts";
import { runWizard, type PromptDef } from "../src/prompts/runner.js";
import { runEnrollFlow } from "../src/registry/enroll.js";
import { loadRegistry } from "../src/registry/store.js";

const mockConfirm  = vi.mocked(inquirer.confirm);
const mockInput    = vi.mocked(inquirer.input);
const mockCheckbox = vi.mocked(inquirer.checkbox);

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
}
function gitRemoteAdd(dir: string, url: string): void {
  execSync(`git remote add origin ${url}`, { cwd: dir, stdio: "ignore" });
}

// ── runner.ts — multiselect prompt type ───────────────────────────────────

describe("runner.ts multiselect", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("wires the checkbox prompt and returns selected values", async () => {
    mockCheckbox.mockResolvedValueOnce(["alpha", "gamma"] as never);

    const manifest: PromptDef[] = [
      {
        key: "picks",
        type: "multiselect",
        message: "Choose items:",
        choices: [
          { name: "Alpha", value: "alpha" },
          { name: "Beta",  value: "beta"  },
          { name: "Gamma", value: "gamma" },
        ],
      },
    ];

    const answers = await runWizard(manifest);

    expect(mockCheckbox).toHaveBeenCalledOnce();
    expect(mockCheckbox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose items:",
        choices: expect.arrayContaining([
          { name: "Alpha", value: "alpha" },
          { name: "Beta",  value: "beta"  },
          { name: "Gamma", value: "gamma" },
        ]),
      }),
    );
    expect(answers["picks"]).toEqual(["alpha", "gamma"]);
  });

  it("respects the when conditional — skips multiselect when guard is false", async () => {
    const manifest: PromptDef[] = [
      { key: "_gate", type: "confirm", message: "Include?", default: false },
      {
        key: "picks",
        type: "multiselect",
        message: "Choose:",
        choices: [{ name: "X", value: "x" }],
        when: (a) => a["_gate"] === true,
      },
    ];

    mockConfirm.mockResolvedValueOnce(false as never);

    const answers = await runWizard(manifest);
    expect(mockCheckbox).not.toHaveBeenCalled();
    expect(answers["picks"]).toBeUndefined();
  });

  it("runner.ts imports nothing from registry, git, or scan", async () => {
    // Static check: confirm the generic runner has no registry/git specifics
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../src/prompts/runner.ts", import.meta.url).pathname,
        "utf-8",
      ),
    );
    expect(src).not.toContain("registry");
    expect(src).not.toContain("scan");
    expect(src).not.toContain("git");
    expect(src).not.toContain("driver");
  });
});

// ── runEnrollFlow ──────────────────────────────────────────────────────────

describe("runEnrollFlow", () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "bumper-enroll-test-"));
    registryPath = join(tempDir, "projects.toml");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty immediately when user declines enrollment", async () => {
    mockConfirm.mockResolvedValueOnce(false as never);

    const result = await runEnrollFlow(registryPath);

    expect(result.enrolled).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(mockInput).not.toHaveBeenCalled();
  });

  it("enrolls selected repos and writes them to the registry", async () => {
    const repoA = join(tempDir, "alpha");
    const repoB = join(tempDir, "beta");
    mkdirSync(repoA);
    mkdirSync(repoB);
    gitInit(repoA);
    gitInit(repoB);
    gitRemoteAdd(repoA, "https://github.com/user/alpha.git");

    mockConfirm.mockResolvedValueOnce(true as never);
    mockInput.mockResolvedValueOnce(tempDir as never);
    // checkbox: select ALL scanned repos
    mockCheckbox.mockImplementationOnce(async (opts: { choices: { value: unknown }[] }) =>
      opts.choices.map((c) => c.value),
    );

    const result = await runEnrollFlow(registryPath);

    expect(result.enrolled).toHaveLength(2);
    expect(result.enrolled.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);

    const registry = loadRegistry(registryPath);
    expect(registry.project).toHaveLength(2);
  });

  it("enrolled repos have correct name, path, remote, and target fields", async () => {
    const repoDir = join(tempDir, "myproject");
    mkdirSync(repoDir);
    gitInit(repoDir);
    gitRemoteAdd(repoDir, "https://github.com/user/myproject.git");

    mockConfirm.mockResolvedValueOnce(true as never);
    mockInput.mockResolvedValueOnce(tempDir as never);
    mockCheckbox.mockImplementationOnce(async (opts: { choices: { value: unknown }[] }) =>
      opts.choices.map((c) => c.value),
    );

    const result = await runEnrollFlow(registryPath);

    expect(result.enrolled).toHaveLength(1);
    const p = result.enrolled[0];
    expect(p.name).toBe("myproject");
    expect(p.path).toBe(repoDir);
    expect(p.remote).toBe("https://github.com/user/myproject.git");
    expect(p.target).toBe("default");
  });

  it("local-only repos get remote '' (empty string, not null)", async () => {
    const repoDir = join(tempDir, "local-only");
    mkdirSync(repoDir);
    gitInit(repoDir);
    // no git remote add

    mockConfirm.mockResolvedValueOnce(true as never);
    mockInput.mockResolvedValueOnce(tempDir as never);
    mockCheckbox.mockImplementationOnce(async (opts: { choices: { value: unknown }[] }) =>
      opts.choices.map((c) => c.value),
    );

    const result = await runEnrollFlow(registryPath);

    expect(result.enrolled).toHaveLength(1);
    expect(result.enrolled[0].remote).toBe("");
  });

  it("enrolled remote has no trailing whitespace (trim check)", async () => {
    const repoDir = join(tempDir, "trimcheck");
    mkdirSync(repoDir);
    gitInit(repoDir);
    gitRemoteAdd(repoDir, "https://github.com/user/trimcheck.git");

    mockConfirm.mockResolvedValueOnce(true as never);
    mockInput.mockResolvedValueOnce(tempDir as never);
    mockCheckbox.mockImplementationOnce(async (opts: { choices: { value: unknown }[] }) =>
      opts.choices.map((c) => c.value),
    );

    const result = await runEnrollFlow(registryPath);

    const remote = result.enrolled[0].remote;
    expect(remote).toBe(remote.trim()); // no leading/trailing whitespace
    expect(remote).not.toMatch(/\n/);
  });

  it("skips duplicates without crashing and reports them in skipped[]", async () => {
    const repoDir = join(tempDir, "dupcheck");
    mkdirSync(repoDir);
    gitInit(repoDir);

    const enrollOnce = async () => {
      mockConfirm.mockResolvedValueOnce(true as never);
      mockInput.mockResolvedValueOnce(tempDir as never);
      mockCheckbox.mockImplementationOnce(async (opts: { choices: { value: unknown }[] }) =>
        opts.choices.map((c) => c.value),
      );
      return runEnrollFlow(registryPath);
    };

    const first = await enrollOnce();
    expect(first.enrolled).toHaveLength(1);
    expect(first.skipped).toHaveLength(0);

    const second = await enrollOnce();
    expect(second.enrolled).toHaveLength(0);
    expect(second.skipped).toEqual(["dupcheck"]);
  });

  it("re-prompts for directory on scan error (nonexistent path), then exits on empty dir", async () => {
    // First dir doesn't exist → error → re-prompt; second is empty → returns []
    mockConfirm.mockResolvedValueOnce(true as never);
    mockInput
      .mockResolvedValueOnce("/nonexistent/path/bumper-test-99999" as never)
      .mockResolvedValueOnce(tempDir as never); // tempDir is empty → returns []

    const result = await runEnrollFlow(registryPath);

    expect(mockInput).toHaveBeenCalledTimes(2);
    expect(result.enrolled).toHaveLength(0);
  });

  it("returns empty when no repos are selected from checkbox", async () => {
    const repoDir = join(tempDir, "notpicked");
    mkdirSync(repoDir);
    gitInit(repoDir);

    mockConfirm.mockResolvedValueOnce(true as never);
    mockInput.mockResolvedValueOnce(tempDir as never);
    mockCheckbox.mockResolvedValueOnce([] as never); // user selects nothing

    const result = await runEnrollFlow(registryPath);

    expect(result.enrolled).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
