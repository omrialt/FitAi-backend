/**
 * Makes a hand-written JSON Schema acceptable to `output_config.format`.
 *
 * Structured outputs compile the schema into a grammar, and a grammar cannot
 * count: the API rejects the whole request with a 400 for `maxItems`,
 * `minItems` above 1, numeric bounds and string lengths. Every schema in this
 * app carried at least one of those, so every AI feature failed on its first
 * real call.
 *
 * The limits are not lost. Each one removed here is appended to the field's
 * description, so the model is still told, and the zod parser every caller
 * already passes still enforces it on the way back in.
 *
 * Not the SDK's `jsonSchemaOutputFormat`: the installed version (0.122) also
 * demotes `enum` to a description, and `enum` is something the API does
 * enforce — the plan's difficulty and the meal parser's units rely on it.
 */

type JsonSchema = Record<string, unknown>;

/** Keywords the API refuses. `minItems` is the exception handled below. */
export const UNSUPPORTED_KEYWORDS: readonly string[] = [
  'maxItems',
  'minItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
];

/** Keywords whose value is a map of name → schema; the names are not keywords. */
const SCHEMA_MAPS = new Set(['properties', '$defs', 'definitions']);

/** Keywords whose value is a list of schemas. */
const SCHEMA_LISTS = new Set(['anyOf', 'allOf', 'oneOf', 'prefixItems']);

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The API accepts `minItems` of 0 or 1 and nothing above it. */
function isSupported(key: string, value: unknown): boolean {
  if (!UNSUPPORTED_KEYWORDS.includes(key)) return true;
  return key === 'minItems' && (value === 0 || value === 1);
}

/** Returns a copy the API accepts. The schema passed in is left untouched. */
export function toApiSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  const removed: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if (!isSupported(key, value)) {
      removed.push(`${key}: ${JSON.stringify(value)}`);
    } else if (SCHEMA_MAPS.has(key) && isSchema(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [
          name,
          isSchema(sub) ? toApiSchema(sub) : sub,
        ]),
      );
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      out[key] = value.map((sub: unknown) =>
        isSchema(sub) ? toApiSchema(sub) : sub,
      );
    } else if (key === 'items' && isSchema(value)) {
      out[key] = toApiSchema(value);
    } else {
      out[key] = value;
    }
  }

  if (removed.length > 0) {
    const note = `{${removed.join(', ')}}`;
    out.description =
      typeof out.description === 'string' && out.description.length > 0
        ? `${out.description}\n\n${note}`
        : note;
  }

  return out;
}
