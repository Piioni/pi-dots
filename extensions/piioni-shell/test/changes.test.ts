import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import type { createReadStream as CreateReadStream } from "node:fs";
import { createChangesReader, type GitRunner } from "../src/changes.ts";

interface StreamObservation { bytes: number; destroyed: boolean; closed: boolean; }

async function observeStreams(run: (observations: StreamObservation[]) => Promise<void>): Promise<void> {
  type Factory = typeof CreateReadStream;
  const fs = createRequire(import.meta.url)("node:fs") as { createReadStream: Factory };
  const original = fs.createReadStream;
  const observations: StreamObservation[] = [];
  fs.createReadStream = ((...args: Parameters<Factory>) => {
    const stream = original(...args);
    const observation = { bytes: 0, destroyed: false, closed: false };
    observations.push(observation);
    stream.on("data", (chunk) => { observation.bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk); });
    stream.once("close", () => { observation.destroyed = stream.destroyed; observation.closed = true; });
    return stream;
  }) as Factory;
  syncBuiltinESMExports();
  try {
    await run(observations);
  } finally {
    fs.createReadStream = original;
    syncBuiltinESMExports();
  }
}

async function withRoots(run: (roots: string[]) => Promise<void>, rootCount = 1): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), "piioni-shell-changes-"));
  const roots = Array.from({ length: rootCount }, (_, index) => join(base, String(index)));
  await Promise.all(roots.map((root) => mkdir(root)));
  try {
    await run(roots);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function runner(paths: () => string[]): GitRunner {
  return async (args) => {
    if (args[0] === "diff") return { stdout: "", code: 0 };
    return { stdout: paths().map((path) => `?? ${path}\0`).join(""), code: 0 };
  };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("counts textual lines with the established newline and Unicode semantics", async () => {
  const cases = [
    ["empty", "", 0],
    ["no final newline", "one", 1],
    ["one final newline", "one\n", 1],
    ["blank line", "\n", 1],
    ["trailing blank line", "one\n\n", 2],
    ["non-ASCII CRLF", "café\r\n雪\r\nfin", 3],
  ] as const;
  await withRoots(async ([root]) => {
    assert.ok(root);
    const paths: string[] = [];
    for (const [name, contents] of cases) {
      const path = `${name}.txt`;
      paths.push(path);
      await writeFile(join(root, path), contents);
    }
    const model = await createChangesReader().read(runner(() => paths), root);
    assert.deepEqual(model?.files.map(({ path, added }) => [path, added]), cases.map(([name, , count]) => [`${name}.txt`, count]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  });
});

test("treats NUL-containing data as binary and counts large text without line splitting", async () => {
  await withRoots(async ([root]) => {
    assert.ok(root);
    const largeText = "line\n".repeat(1_000_000);
    const binarySize = 32 * 1024 * 1024;
    const binary = Buffer.alloc(binarySize);
    binary[0] = 0;
    await writeFile(join(root, "large.txt"), largeText);
    await writeFile(join(root, "binary.bin"), binary);
    await observeStreams(async (observations) => {
      const model = await createChangesReader().read(runner(() => ["large.txt", "binary.bin"]), root);
      assert.deepEqual(model?.files.map(({ path, added }) => [path, added]), [["binary.bin", 0], ["large.txt", 1_000_000]]);
      const binaryStream = observations[0];
      assert.ok(binaryStream);
      assert.ok(binaryStream.bytes < binarySize, `binary scan emitted ${binaryStream.bytes} of ${binarySize} bytes`);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(binaryStream.closed, true);
      assert.equal(binaryStream.destroyed, true);
    });
  });
});

test("refreshes changed and deleted files and discards counts when the root changes", async () => {
  await withRoots(async ([firstRoot, secondRoot]) => {
    assert.ok(firstRoot && secondRoot);
    const reader = createChangesReader();
    let paths = ["file.txt"];
    const git = runner(() => paths);
    const firstFile = join(firstRoot, "file.txt");
    const secondFile = join(secondRoot, "file.txt");

    await writeFile(firstFile, "old\n");
    assert.equal((await reader.read(git, firstRoot))?.added, 1);
    await writeFile(firstFile, "changed\nagain\n");
    assert.equal((await reader.read(git, firstRoot))?.added, 2);

    paths = [];
    assert.equal((await reader.read(git, firstRoot))?.files.length, 0);
    paths = ["file.txt"];
    await writeFile(secondFile, "root\nchanged\nagain\n");
    assert.equal((await reader.read(git, secondRoot))?.added, 3);

    await rm(secondFile);
    assert.equal((await reader.read(git, secondRoot))?.added, 0);
    reader.clear();
  }, 2);
});

test("a read finishing after a root switch cannot replace the current root cache", async () => {
  await withRoots(async ([oldRoot, currentRoot]) => {
    assert.ok(oldRoot && currentRoot);
    const reader = createChangesReader();
    const oldPath = join(oldRoot, "same.txt");
    const currentPath = join(currentRoot, "same.txt");
    await writeFile(oldPath, "old root\n");
    await writeFile(currentPath, "current root\ncurrent root\n");
    const gate = deferred();
    const oldGit: GitRunner = async (args) => {
      if (args[0] === "diff") await gate.promise;
      return args[0] === "diff" ? { stdout: "", code: 0 } : { stdout: "?? same.txt\0", code: 0 };
    };
    const currentGit = runner(() => ["same.txt"]);

    await observeStreams(async (observations) => {
      const oldRead = reader.read(oldGit, oldRoot);
      assert.equal((await reader.read(currentGit, currentRoot))?.added, 2);
      gate.resolve();
      assert.equal((await oldRead)?.added, 1);
      const streamsAfterOldRead = observations.length;
      assert.equal((await reader.read(currentGit, currentRoot))?.added, 2);
      assert.equal(observations.length, streamsAfterOldRead, "current-root line count should remain cached");
    });
  }, 2);
});

test("clear during a read prevents its result from repopulating the cache", async () => {
  await withRoots(async ([root]) => {
    assert.ok(root);
    const reader = createChangesReader();
    await writeFile(join(root, "later.txt"), "one\ntwo\n");
    const gate = deferred();
    const oldGit: GitRunner = async (args) => {
      if (args[0] === "diff") await gate.promise;
      return args[0] === "diff" ? { stdout: "", code: 0 } : { stdout: "?? later.txt\0", code: 0 };
    };
    const noChanges = runner(() => []);
    const fileAppears = runner(() => ["later.txt"]);

    await observeStreams(async (observations) => {
      const oldRead = reader.read(oldGit, root);
      reader.clear();
      assert.equal((await reader.read(noChanges, root))?.files.length, 0);
      gate.resolve();
      assert.equal((await oldRead)?.added, 2);
      const streamsAfterStaleRead = observations.length;
      assert.equal((await reader.read(fileAppears, root))?.added, 2);
      assert.equal(observations.length, streamsAfterStaleRead + 1, "post-clear status must recount instead of using a pre-clear read");
    });
  });
});
