import * as fs from 'fs';
import * as path from 'path';
import { Workspace } from './mcp/workspace';
import { loadSchemaModels } from './mcp/schema-reader';

function outputPath(root: string, value: string): string {
  const target = path.resolve(root, value);
  const inside = (base: string, file: string) => { const relative = path.relative(base, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  if (!inside(path.resolve(root), target)) throw new Error('Generated output must remain inside the workspace.');
  let parent = target;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (!inside(fs.realpathSync(root), fs.realpathSync(parent))) throw new Error('Generated output symlinks must remain inside the workspace.');
  return target;
}
/** Generate only the requested language, preserving other configured output targets. */
export async function generateClient(ws: Workspace, language: string, override?: string): Promise<{ language: string; outputDir: string; modelCount: number }> {
  if (!['typescript', 'python', 'dotnet', 'golang', 'rust', 'java', 'kotlin', 'swift'].includes(language)) throw new Error('Unsupported client language.');
  if (!ws.ormDir) throw new Error('Install @an5/orm in this workspace to generate a client.');
  const gen = require(path.join(ws.ormDir, 'dist', 'generator', 'src', 'api.js'));
  const models = await loadSchemaModels(ws);
  if (!models.length) throw new Error('No models found. Add a .an5 schema before generating a client.');
  const config = ws.config.outputs?.[language];
  const defaultDir = language === 'python' && config?.metadataFile ? path.dirname(config.metadataFile) : `an5Client/${language}`;
  const dir = outputPath(ws.root, override || config?.outputDir || defaultDir);
  const metadataFile = outputPath(ws.root, override ? path.join(override, language === 'python' ? 'an5_metadata.py' : 'an5Metadata.ts') : config?.metadataFile || path.join(dir, language === 'python' ? 'an5_metadata.py' : 'an5Metadata.ts'));
  if (language === 'typescript' && path.extname(metadataFile) !== '.ts' || language === 'python' && path.extname(metadataFile) !== '.py') throw new Error('Metadata must use the target language file extension.');
  const constructors: Record<string, string> = { typescript: 'CodeGenerator', python: 'PythonGenerator', dotnet: 'DotnetGenerator', golang: 'GolangGenerator', rust: 'RustGenerator', java: 'JavaGenerator', kotlin: 'KotlinGenerator', swift: 'SwiftGenerator' };
  const Generator = gen[constructors[language]];
  if (typeof Generator !== 'function') throw new Error('The installed ORM does not provide this language generator.');
  fs.mkdirSync(dir, { recursive: true });
  if (language === 'python') fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
  new Generator(language === 'python' ? metadataFile : dir).generate(models);
  const generation = ws.config.generation as { generateMetadata?: boolean } | undefined;
  if (language === 'typescript' && generation?.generateMetadata !== false) {
    fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
    new gen.MetadataGenerator(metadataFile).generate(models);
  }
  return { language, outputDir: dir, modelCount: models.length };
}
