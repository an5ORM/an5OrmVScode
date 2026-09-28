/**
 * Parser for `.an5` schema files.
 *
 * Self-contained on purpose: the MCP server must answer schema questions in a
 * workspace that has not installed the ORM yet, so it cannot depend on the
 * `@an5/orm` generator being present.
 */

export interface An5Field {
  name: string;
  /** Declared SQL type, e.g. `NVARCHAR(255)`. */
  sqlType: string;
  isOptional: boolean;
  isId: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  attributes: string[];
  description?: string;
}

export interface An5Relation {
  name: string;
  /** Target model name. */
  target: string;
  isArray: boolean;
  isOptional: boolean;
  foreignKey?: string;
  localKey?: string;
  /** From a trailing `@description("...")` on the relation line. */
  description?: string;
}

export interface An5Model {
  name: string;
  tableName: string;
  schemaName: string;
  description?: string;
  fields: An5Field[];
  relations: An5Relation[];
  /** Declared in which `.an5` file. */
  sourceFile?: string;
}

const SQL_TYPE = /^[A-Z][A-Z0-9_]*(\(.*\))?$/;

function toSnakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Resolves relation key columns. A to-one relation declares them inline; a
 * to-many relation is inferred from the opposite side when that side is
 * explicit, which is how `orders Order[]` gets `userId`/`id`.
 */
function resolveRelationKeys(models: An5Model[]): void {
  for (const model of models) {
    for (const relation of model.relations) {
      if (relation.foreignKey && relation.localKey) continue;
      const target = models.find((m) => m.name === relation.target);
      if (!target) continue;

      const opposite = target.relations.find((r) => r.target === model.name);
      if (opposite?.foreignKey && opposite?.localKey) {
        relation.foreignKey = opposite.foreignKey;
        relation.localKey = opposite.localKey;
        continue;
      }
      // Fall back to the conventional `<target>Id` / `id` pair.
      relation.localKey = relation.localKey ?? 'id';
      relation.foreignKey = relation.foreignKey ?? `${toSnakeCase(target.name)}Id`;
    }
  }
}

function parseModelBlock(name: string, body: string[], sourceFile: string): An5Model {
  const model: An5Model = {
    name,
    tableName: `${name.toLowerCase()}s`,
    schemaName: 'dbo',
    fields: [],
    relations: [],
    sourceFile,
  };

  for (const raw of body) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    const mapMatch = line.match(/^@@map\("(.+)"\)/);
    if (mapMatch?.[1]) {
      model.tableName = mapMatch[1];
      continue;
    }
    const schemaMatch = line.match(/^@@schema\("(.+)"\)/);
    if (schemaMatch?.[1]) {
      model.schemaName = schemaMatch[1];
      continue;
    }
    const descriptionMatch = line.match(/^@@description\("(.+)"\)/);
    if (descriptionMatch?.[1]) {
      model.description = descriptionMatch[1];
      continue;
    }
    if (line.startsWith('@@')) continue;

    const [fieldName, rawType] = line.split(/\s+/, 2);
    if (!fieldName || !rawType) continue;

    const isArray = rawType.endsWith('[]');
    const isOptional = rawType.endsWith('?');
    const baseType = rawType.replace('[]', '').replace('?', '');
    const attributes = line.split(/\s+/).slice(2);
    // A description can sit on a field or on a relation, so read it once here.
    const lineDescription = line.match(/@description\("(.+)"\)/)?.[1];

    if (!SQL_TYPE.test(baseType)) {
      model.relations.push({
        name: fieldName,
        target: baseType,
        isArray,
        isOptional,
        foreignKey: line.match(/fields:\s*\[(\w+)\]/)?.[1],
        localKey: line.match(/references:\s*\[(\w+)\]/)?.[1],
        ...(lineDescription ? { description: lineDescription } : {}),
      });
      continue;
    }

    model.fields.push({
      name: fieldName,
      sqlType: baseType,
      isOptional,
      isId: attributes.includes('@id'),
      isUnique: attributes.includes('@unique'),
      hasDefault: attributes.some((a) => a.startsWith('@default')),
      attributes,
      ...(lineDescription ? { description: lineDescription } : {}),
    });
  }

  return model;
}

/** Parses one `.an5` file into its models. */
export function parseAn5File(filePath: string, contents: string): An5Model[] {
  const models: An5Model[] = [];
  const lines = contents.split(/\r?\n/);

  let current: { name: string; body: string[] } | null = null;
  for (const line of lines) {
    const header = line.match(/^model\s+(\w+)\s*\{/);
    if (header?.[1]) {
      current = { name: header[1], body: [] };
      continue;
    }
    if (line.trim() === '}') {
      if (current) models.push(parseModelBlock(current.name, current.body, filePath));
      current = null;
      continue;
    }
    if (current) current.body.push(line);
  }
  // Tolerate a missing trailing brace so a half-written file still yields data.
  if (current) models.push(parseModelBlock(current.name, current.body, filePath));

  return models;
}

/** Parses every `.an5` file in a list and resolves relation keys. */
export function parseSchemaFiles(files: Array<{ path: string; contents: string }>): An5Model[] {
  const models: An5Model[] = [];
  for (const file of files) {
    models.push(...parseAn5File(file.path, file.contents));
  }
  resolveRelationKeys(models);
  return models;
}

/** Analyzes a model set for common design problems. */
export function analyzeSchema(models: An5Model[]): {
  issues: Array<{ severity: string; model: string; field?: string; message: string; suggestion?: string }>;
  summary: { totalModels: number; totalFields: number; totalRelations: number; issues: number };
} {
  const issues: Array<{ severity: string; model: string; field?: string; message: string; suggestion?: string }> = [];

  for (const model of models) {
    if (!model.fields.some((f) => f.isId)) {
      issues.push({
        severity: 'error',
        model: model.name,
        message: `Model "${model.name}" has no primary key.`,
        suggestion: 'Mark a field with @id',
      });
    }
    if (!model.fields.some((f) => f.name === 'createdAt')) {
      issues.push({
        severity: 'info',
        model: model.name,
        message: `Model "${model.name}" has no createdAt timestamp.`,
        suggestion: 'Add `createdAt DATETIME2 @default(now())` to track row creation',
      });
    }

    for (const field of model.fields) {
      const isFkCandidate = field.name.toLowerCase().endsWith('id') && !field.isId;
      if (isFkCandidate && !field.isUnique && !field.attributes.includes('@index')) {
        issues.push({
          severity: 'warning',
          model: model.name,
          field: field.name,
          message: `Foreign key "${field.name}" is not indexed.`,
          suggestion: `Add an index on "${field.name}" to speed up joins`,
        });
      }
      const uniqueCandidates = ['email', 'username', 'slug', 'sku', 'code'];
      if (uniqueCandidates.includes(field.name.toLowerCase()) && !field.isUnique && !field.isId) {
        issues.push({
          severity: 'warning',
          model: model.name,
          field: field.name,
          message: `Candidate unique field "${field.name}" is not marked @unique.`,
          suggestion: `Add @unique to "${field.name}"`,
        });
      }
    }
  }

  return {
    issues,
    summary: {
      totalModels: models.length,
      totalFields: models.reduce((n, m) => n + m.fields.length, 0),
      totalRelations: models.reduce((n, m) => n + m.relations.length, 0),
      issues: issues.length,
    },
  };
}
