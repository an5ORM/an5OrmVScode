import * as fs from 'fs';
import * as path from 'path';

/** Saves or updates DATABASE_URL inside the project's .env file. */
export function saveConnectionToEnv(root: string, connectionString: string): string {
  const envPath = path.join(root, '.env');
  const sanitized = connectionString.replace(/[\r\n]/g, '');
  const line = `DATABASE_URL="${sanitized.replace(/"/g, '\\"')}"`;

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `${line}\n`, 'utf8');
    return '.env';
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const newLines = lines.map(l => {
    if (/^\s*(?:export\s+)?DATABASE_URL\s*=/.test(l)) {
      replaced = true;
      return line;
    }
    return l;
  });

  if (!replaced) {
    if (newLines.length > 0 && newLines[newLines.length - 1] !== '') {
      newLines.push('');
    }
    newLines.push(line);
  }

  fs.writeFileSync(envPath, newLines.join('\n') + '\n', 'utf8');
  return '.env';
}

/** Saves or updates connectionString inside an5Orm.config.js / .cjs. */
export function saveConnectionToConfig(root: string, connectionString: string): string {
  const configNames = ['an5Orm.config.js', 'an5Orm.config.cjs'];
  let configPath = configNames.map(n => path.join(root, n)).find(p => fs.existsSync(p));
  const sanitized = connectionString.replace(/[\r\n]/g, '');
  const configRel = configPath ? path.basename(configPath) : 'an5Orm.config.js';

  if (!configPath) {
    configPath = path.join(root, 'an5Orm.config.js');
    const template = `/**
 * AN5 ORM Configuration
 */
module.exports = {
  connectionString: ${JSON.stringify(sanitized)},
  schemaDir: 'an5Schema',
  outputs: {
    typescript: {
      outputDir: 'an5Client/typescript',
      metadataFile: 'an5Client/typescript/an5Metadata.ts',
    },
    python: {
      metadataFile: 'an5Client/python/an5_metadata.py',
    },
    dotnet: {
      outputDir: 'an5Client/dotnet',
    },
    golang: { outputDir: 'an5Client/golang' },
    rust: { outputDir: 'an5Client/rust' },
    java: { outputDir: 'an5Client/java' },
    kotlin: { outputDir: 'an5Client/kotlin' },
    swift: { outputDir: 'an5Client/swift' },
  },
  pull: {
    exclude: ['^__', '^sys\\\\.', '^igrations'],
    preserveRelations: true,
  },
  generation: {
    generateMetadata: true,
  },
};
`;
    fs.writeFileSync(configPath, template, 'utf8');
    return configRel;
  }

  const content = fs.readFileSync(configPath, 'utf8');
  // Check if connectionString property already exists in active form
  if (/\bconnectionString\s*:\s*(?:process\.env\.[A-Za-z0-9_]+|['"`][^'"`]*['"`])/.test(content)) {
    const updated = content.replace(
      /\bconnectionString\s*:\s*(?:process\.env\.[A-Za-z0-9_]+|['"`][^'"`]*['"`])/,
      `connectionString: ${JSON.stringify(sanitized)}`
    );
    fs.writeFileSync(configPath, updated, 'utf8');
    return configRel;
  }

  // If commented out connectionString: '...' is present
  if (/\/\*[\s\S]*?connectionString[\s\S]*?\*\//.test(content) || /\/\/\s*connectionString\s*:/.test(content)) {
    // Insert after module.exports = {
    if (/module\.exports\s*=\s*\{/.test(content)) {
      const updated = content.replace(
        /module\.exports\s*=\s*\{/,
        `module.exports = {\n  connectionString: ${JSON.stringify(sanitized)},`
      );
      fs.writeFileSync(configPath, updated, 'utf8');
      return configRel;
    }
  }

  // Standard module.exports insertion
  if (/module\.exports\s*=\s*\{/.test(content)) {
    const updated = content.replace(
      /module\.exports\s*=\s*\{/,
      `module.exports = {\n  connectionString: ${JSON.stringify(sanitized)},`
    );
    fs.writeFileSync(configPath, updated, 'utf8');
    return configRel;
  }

  // Fallback append
  fs.writeFileSync(
    configPath,
    content + `\nmodule.exports.connectionString = ${JSON.stringify(sanitized)};\n`,
    'utf8'
  );
  return configRel;
}
