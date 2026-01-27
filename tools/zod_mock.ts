// zod_mock.ts
import { z } from "zod";
import type { ZodTypeAny } from "zod";

export function mockFromSchema<T extends ZodTypeAny>(
  schema: T,
  num: number
): z.output<T> {
  return mockFromSchemaImpl(schema, num) as z.output<T>;
}

function pickIndex(num: number, len: number) {
  if (len <= 0) return 0;
  const n = Number.isFinite(num) ? Math.trunc(num) : 0;
  return ((n % len) + len) % len;
}

function mockFromSchemaImpl(schema: ZodTypeAny, num: number): unknown {
  if (!schema) throw new Error("schema is undefined");

  if (schema instanceof z.ZodAny) return null;
  if (schema instanceof z.ZodUnknown) return null;
  if (schema instanceof z.ZodNull) return null;

  const def = (schema as any)._def;

  if (schema instanceof z.ZodString) return `mock_string_${num}`;
  if (schema instanceof z.ZodNumber) return 1700000000 + num; // ちょい変化
  if (schema instanceof z.ZodBoolean) return (num % 2) === 0;

  if (schema instanceof z.ZodLiteral) {
    const d: any = def;
    return d.value ?? d.values?.[0] ?? d.expected ?? d.literal ?? d?.innerType?._def?.value;
  }

  // ★enum を num で回す
  if (schema instanceof z.ZodEnum) {
    const values: string[] = (schema as any).options ?? (schema as any)._def?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("ZodEnum has no values/options");
    }
    return values[pickIndex(num, values.length)];
  }


  // optional: num によって省略したいなら undefined を返す
  if (schema instanceof z.ZodOptional) {
    if ((num % 3) === 1) return undefined; 
    return mockFromSchemaImpl(def.innerType, num);
  }

  // nullable: num によって null にする
  if (schema instanceof z.ZodNullable) {
    if ((num % 3) === 2) return null;
    return mockFromSchemaImpl(def.innerType, num);
  }

  if (schema instanceof z.ZodDefault) {
    // default は「値を作る」方針なら innerType を作る
    return mockFromSchemaImpl(def.innerType, num);
  }

  if (schema instanceof z.ZodArray) {
    const elementSchema = (schema as any).element as ZodTypeAny;
    const len = Math.max(1, (num % 3) + 1);
    return Array.from({ length: len }, (_, i) => mockFromSchemaImpl(elementSchema, num + i));
  }

  if (schema instanceof z.ZodObject) {
    // ★shape が関数のケースもある
    const shapeOrFn = (schema as any).shape;
    const shape: Record<string, ZodTypeAny> =
      typeof shapeOrFn === "function" ? shapeOrFn() : shapeOrFn;

    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const v = mockFromSchemaImpl(shape[key], num);
      if (v !== undefined) obj[key] = v; 
    }
    return obj;
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = def.options instanceof Map ? Array.from(def.options.values()) : def.options;
    const picked = options[pickIndex(num, options.length)];
    return mockFromSchemaImpl(picked, num);
  }

  if (schema instanceof z.ZodUnion) {
    const options: ZodTypeAny[] = def.options ?? [];
    const picked = options[pickIndex(num, options.length)];
    return mockFromSchemaImpl(picked, num);
  }

  throw new Error("Unsupported schema kind");
}
