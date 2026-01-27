import Ajv from "ajv";
import fs from "node:fs";
import path from "node:path";

const schema = JSON.parse(
  fs.readFileSync("fixtures/schema.json", "utf8")
);

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// fixtures 内の schema.json 以外を全部検証
for (const f of fs.readdirSync("fixtures").filter(x => x.endsWith(".json") && x !== "schema.json")) {
  const data = JSON.parse(fs.readFileSync(path.join("fixtures", f), "utf8"));

  if (!validate(data)) {
    console.error(`❌ ${f} invalid`);
    console.error(validate.errors);
    process.exit(1);
  }

  console.log(`✅ ${f} valid`);
}

console.log("🎉 all metadata json valid against Rust schema");
