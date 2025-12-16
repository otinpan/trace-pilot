import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as repository from "../repository/repository";

// 単体テスト
suite("Get Git repository path", () => {
  test("getRepositoryPath from ~/thesis/trace-pilot/src/engine", async () => {
    const home = os.homedir();

    const gitRoot = path.join(home, "thesis", "trace-pilot");
    const cwdPath = path.join(home, "thesis", "trace-pilot", "src", "engine");

    // フォルダが無い環境でもテストが爆発しないように（
    assert.ok(fs.existsSync(cwdPath), `Test folder does not exist: ${cwdPath}`);

    const detectedRoot = await repository.getRepositoryPath(cwdPath);

    console.log(detectedRoot);
    console.log(gitRoot);

    assert.strictEqual(
      path.resolve(detectedRoot),
      path.resolve(gitRoot),
    );
  });

  test("getRepositoryPath from ~/thesis/private_for_thesis/Papers/Assets", async () => {
    const home = os.homedir();

    const gitRoot = path.join(home, "thesis", "private_for_thesis");
    const cwdPath = path.join(home, "thesis", "private_for_thesis","Papers","Assets");

    // フォルダが無い環境でもテストが爆発しないように（
    assert.ok(fs.existsSync(cwdPath), `Test folder does not exist: ${cwdPath}`);

    const detectedRoot = await repository.getRepositoryPath(cwdPath);

    console.log(detectedRoot);
    console.log(gitRoot);

    assert.strictEqual(
      path.resolve(detectedRoot),
      path.resolve(gitRoot),
    );
  });
});


