import Ajv from "ajv";
import fs from "node:fs";

const schema = JSON.parse(fs.readFileSync("fixtures/schema.json", "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
const validateMetadata = ajv.compile(schema); // ここは出し方に合わせて調整（後述）

// 例：保存済み JSON を全部検証（fixtures/ に置く or 生成物を置く）
for (const f of fs.readdirSync("saved").filter(x => x.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(`saved/${f}`, "utf8"));
  const ok = validateMetadata(data);
  if (!ok) {
    console.error(`❌ ${f} invalid`);
    console.error(validateMetadata.errors);
    process.exit(1);
  }
}

console.log("✅ all saved json valid");
