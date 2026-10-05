import * as fs from 'fs';
import * as path from 'path';
import { Script } from 'vm';

export interface ProjectSettings {
  schemaDir: string;
  typescriptDir: string;
  typescriptMetadata: string;
  pythonMetadata: string;
  dotnetDir: string;
  golangDir: string;
  rustDir: string;
  javaDir: string;
  kotlinDir: string;
  swiftDir: string;
}

export function projectSettings(config: Record<string, unknown>): ProjectSettings {
  const outputs = config.outputs as Record<string, Record<string, unknown>> | undefined;
  const value = (language: string, key: string, fallback: string) => typeof outputs?.[language]?.[key] === 'string' ? String(outputs[language][key]) : fallback;
  return {
    schemaDir: typeof config.schemaDir === 'string' ? config.schemaDir : 'an5Schema',
    typescriptDir: value('typescript', 'outputDir', 'an5Client/typescript'),
    typescriptMetadata: value('typescript', 'metadataFile', 'an5Client/typescript/an5Metadata.ts'),
    pythonMetadata: value('python', 'metadataFile', 'an5Client/python/an5_metadata.py'),
    dotnetDir: value('dotnet', 'outputDir', 'an5Client/dotnet'),
    golangDir: value('golang', 'outputDir', 'an5Client/golang'),
    rustDir: value('rust', 'outputDir', 'an5Client/rust'),
    javaDir: value('java', 'outputDir', 'an5Client/java'),
    kotlinDir: value('kotlin', 'outputDir', 'an5Client/kotlin'),
    swiftDir: value('swift', 'outputDir', 'an5Client/swift'),
  };
}

const START = '// AN5 project settings: start';
const END = '// AN5 project settings: end';

/** Preserve the project's JavaScript and credentials; manage only path overrides. */
export function saveProjectSettings(root: string, raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Enter the project paths.');
  const values = raw as Record<string, unknown>;
  const settings = {} as ProjectSettings;
  const defaults = projectSettings({});
  if (Object.keys(values).some(key => !(key in defaults))) throw new Error('Unknown project setting.');
  for (const key of Object.keys(defaults) as (keyof ProjectSettings)[]) {
    const value = values[key];
    if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value) || value.length > 500) throw new Error(`Enter a valid path for ${key}.`);
    const relative = path.relative(root, path.resolve(root, value.trim()));
    if (path.isAbsolute(value) || relative === '..' || relative.startsWith('..' + path.sep) || /^[A-Za-z]:|^\\\\/.test(value)) throw new Error(`${key} must be a path inside this project.`);
    settings[key] = value.trim();
  }
  const configName = ['an5Orm.config.js', 'an5Orm.config.cjs'].find(name => fs.existsSync(path.join(root, name))) || 'an5Orm.config.js';
  const filename = path.join(root, configName);
  if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink()) throw new Error('Edit the linked configuration at its source.');
  let source = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : 'module.exports = {};\n';
  const start = source.indexOf(START), end = source.indexOf(END);
  if ((start < 0) !== (end < 0) || (start >= 0 && (end < start || source.indexOf(START, start + START.length) >= 0))) throw new Error('Project settings markers are invalid; repair the configuration before saving.');
  const outputs = {
    typescript: { outputDir: settings.typescriptDir, metadataFile: settings.typescriptMetadata },
    python: { metadataFile: settings.pythonMetadata },
    dotnet: { outputDir: settings.dotnetDir },
    golang: { outputDir: settings.golangDir },
    rust: { outputDir: settings.rustDir },
    java: { outputDir: settings.javaDir },
    kotlin: { outputDir: settings.kotlinDir },
    swift: { outputDir: settings.swiftDir },
  };
  const block = `${START}\nmodule.exports = {\n  ...module.exports,\n  schemaDir: ${JSON.stringify(settings.schemaDir)},\n  outputs: {\n    ...module.exports.outputs,\n${Object.entries(outputs).map(([language, output]) => `    ${language}: { ...module.exports.outputs?.${language}, ...${JSON.stringify(output)} },`).join('\n')}\n  },\n};\n${END}`;
  source = start >= 0 ? source.slice(0, start) + block + source.slice(end + END.length) : source.trimEnd() + '\n\n' + block + '\n';
  try { new Script(source, { filename }); }
  catch { throw new Error('The ORM configuration contains invalid JavaScript. Repair it before saving project settings.'); }
  fs.writeFileSync(filename, source, 'utf8');
  return configName;
}
