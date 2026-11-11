import { toApiSchema, UNSUPPORTED_KEYWORDS } from './api-schema';
import { ANSWER_JSON_SCHEMA } from '../../objects/ai-coach/coach-chat.service';
import { PLAN_JSON_SCHEMA } from '../../objects/ai-coach/plan-generator.service';
import { REVIEW_JSON_SCHEMA } from '../../objects/ai-review/ai-review.service';
import { PARSE_JSON_SCHEMA } from '../../objects/food/food.service';

interface Schema {
  [keyword: string]: unknown;
  properties?: Record<string, Schema>;
  items?: Schema;
  enum?: unknown[];
}

/**
 * Every keyword the API would reject that is still present, as paths.
 *
 * Walks the schema the way the API reads it: the keys of `properties` are
 * field names, not keywords, so a field called `maximum` is not a violation.
 */
function violations(schema: Schema, path = '$'): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.includes(key)) {
      if (!(key === 'minItems' && (value === 0 || value === 1))) {
        found.push(`${path}.${key}`);
      }
    }
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      for (const [name, sub] of Object.entries(value as Schema)) {
        found.push(...violations(sub as Schema, `${path}.${key}.${name}`));
      }
    } else if (key === 'items' && value && typeof value === 'object') {
      found.push(...violations(value as Schema, `${path}.items`));
    } else if ((key === 'anyOf' || key === 'allOf') && Array.isArray(value)) {
      value.forEach((sub, i) =>
        found.push(...violations(sub as Schema, `${path}.${key}[${i}]`)),
      );
    }
  }
  return found;
}

describe('toApiSchema', () => {
  // The bug: `maxItems` on the coach's answer made the API refuse the whole
  // request with a 400, so the feature had never once produced an answer.
  it('removes maxItems and keeps it in the description', () => {
    const out = toApiSchema({
      type: 'array',
      maxItems: 5,
      items: { type: 'string' },
      description: 'The figures this rests on.',
    });

    expect(out).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'The figures this rests on.\n\n{maxItems: 5}',
    });
  });

  it('writes a description when the field had none', () => {
    expect(toApiSchema({ type: 'integer', minimum: 1, maximum: 10 })).toEqual({
      type: 'integer',
      description: '{minimum: 1, maximum: 10}',
    });
  });

  it('removes string length limits', () => {
    expect(
      toApiSchema({ type: 'string', minLength: 1, maxLength: 60 }),
    ).toEqual({ type: 'string', description: '{minLength: 1, maxLength: 60}' });
  });

  // The API accepts minItems of 0 or 1 and nothing above it.
  it('keeps minItems of 1 and removes anything larger', () => {
    expect(toApiSchema({ type: 'array', minItems: 1, items: {} })).toEqual({
      type: 'array',
      minItems: 1,
      items: {},
    });
    expect(toApiSchema({ type: 'array', minItems: 2, items: {} })).toEqual({
      type: 'array',
      items: {},
      description: '{minItems: 2}',
    });
  });

  // Supported by the API, and the reason the SDK's own transform is not used:
  // it demotes enum to a description, which stops constraining the model.
  it('leaves enum, required and additionalProperties alone', () => {
    const schema = {
      type: 'object',
      properties: {
        difficulty: { type: 'string', enum: ['beginner', 'advanced'] },
        unit: { type: ['string', 'null'], enum: ['g', null] },
      },
      required: ['difficulty', 'unit'],
      additionalProperties: false,
    };

    expect(toApiSchema(schema)).toEqual(schema);
  });

  it('treats the keys of properties as field names, not keywords', () => {
    const out = toApiSchema({
      type: 'object',
      properties: {
        maximum: { type: 'number', maximum: 100 },
        maxItems: { type: 'string' },
      },
      required: ['maximum', 'maxItems'],
      additionalProperties: false,
    }) as Schema;

    expect(Object.keys(out.properties ?? {})).toEqual(['maximum', 'maxItems']);
    expect(out.properties?.maximum).toEqual({
      type: 'number',
      description: '{maximum: 100}',
    });
  });

  it('reaches into items, anyOf and $defs', () => {
    const out = toApiSchema({
      type: 'object',
      properties: {
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: { sets: { type: 'integer', maximum: 10 } },
          },
        },
        qty: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
      },
      $defs: { name: { type: 'string', maxLength: 5 } },
    });

    expect(violations(out)).toEqual([]);
  });

  it('does not modify the schema it was given', () => {
    const schema = { type: 'array', maxItems: 3, items: { type: 'string' } };
    const before = JSON.stringify(schema);

    toApiSchema(schema);

    expect(JSON.stringify(schema)).toBe(before);
  });
});

/**
 * The schemas the app actually sends. A new feature that adds a constraint the
 * API rejects is caught here, not by its first user.
 */
describe('the schemas each AI feature sends', () => {
  const schemas: Array<[string, Schema]> = [
    ['coach chat', ANSWER_JSON_SCHEMA],
    ['plan generator', PLAN_JSON_SCHEMA],
    ['weekly review', REVIEW_JSON_SCHEMA],
    ['meal parser', PARSE_JSON_SCHEMA],
  ];

  it.each(schemas)('%s: nothing the API rejects is left', (_name, schema) => {
    expect(violations(toApiSchema(schema))).toEqual([]);
  });

  // Guards the guard: if these stopped carrying limits, the test above would
  // pass without proving anything.
  it('they do carry such constraints before the transform', () => {
    for (const [, schema] of schemas) {
      expect(violations(schema).length).toBeGreaterThan(0);
    }
  });

  it('the plan keeps its difficulty enum and the meal its units', () => {
    const plan = toApiSchema(PLAN_JSON_SCHEMA) as Schema;
    const meal = toApiSchema(PARSE_JSON_SCHEMA) as Schema;

    expect(plan.properties?.difficulty.enum).toEqual([
      'beginner',
      'intermediate',
      'advanced',
    ]);
    expect(meal.properties?.items.items?.properties?.unit.enum).toContain('g');
  });
});
