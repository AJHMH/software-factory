import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { rawGit } from './coverage-evaluation.mjs';

/** @typedef {{repo:string,revision:string,prefix:string,manifest:Record<string,any>}} Context */
/** @param {Context} ctx */
export function cliLayout(ctx) {
  const config = JSON.parse(rawGit(ctx.repo, ['show', `${ctx.revision}:${ctx.prefix}tsconfig.json`]));
  const options = config.compilerOptions;
  if (config.extends || config.references || JSON.stringify(config.include) !== JSON.stringify(['src/**/*.ts']) || config.files || config.exclude || options?.rootDir !== 'src' || options.outDir !== 'dist' || options.module !== 'NodeNext' || options.moduleResolution !== 'NodeNext' || options.declaration !== true || options.sourceMap !== true || options.noEmit || options.emitDeclarationOnly || options.declarationDir || options.outFile || options.incremental || options.composite || options.plugins || options.inlineSourceMap || options.sourceRoot || options.mapRoot || options.allowJs) throw new Error('Unsupported CLI compiler layout.');
  if (ctx.manifest.type !== 'module' || ctx.manifest.workspaces || Object.keys(ctx.manifest.dependencies ?? {}).length || Object.keys(ctx.manifest.optionalDependencies ?? {}).length || Object.keys(ctx.manifest.peerDependencies ?? {}).length || !/^\d+\.\d+\.\d+$/.test(ctx.manifest.devDependencies?.typescript ?? '')) throw new Error('CLI profile requires ESM, pinned TypeScript and no runtime dependencies.');
  const tree = rawGit(ctx.repo, ['ls-tree', '-r', '-z', ctx.revision, '--', `${ctx.prefix}src/`]).split('\0').filter(Boolean);
  const sources = tree.map(entry => {
    const [mode, path] = entry.split('\t');
    if (!/^100(644|755) blob /.test(mode) || !path.endsWith('.ts') || path.endsWith('.d.ts') || !/^[A-Za-z0-9_./-]+$/.test(path) || path.split('/').some(part => part === '..' || part === '.')) throw new Error('Unsupported CLI source file.');
    return path.slice(ctx.prefix.length);
  }).sort();
  if (!sources.length || !sources.includes('src/cli.ts') || JSON.stringify(ctx.manifest.bin) !== JSON.stringify({ aios: 'dist/cli.js' })) throw new Error('Unsupported CLI entry point.');
  const outputs = sources.flatMap(path => {
    const base = 'dist/' + path.slice('src/'.length, -'.ts'.length);
    return [base + '.js', base + '.js.map', base + '.d.ts'];
  }).sort();
  return { sources, outputs };
}

/** Bind all committed TypeScript sources and compiler options, not just the entry point. @param {Context} ctx */
export function cliSource(ctx) {
  const { sources } = cliLayout(ctx);
  return Buffer.from(JSON.stringify(['tsconfig.json', ...sources].map(path => [path, rawGit(ctx.repo, ['show', `${ctx.revision}:${ctx.prefix}${path}`])])));
}

/** @param {string} root @param {string} [prefix] @returns {string[]} */
function inventory(root, prefix = '') {
  const stat = lstatSync(join(root, prefix));
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('CLI output directory must be ordinary.');
  return readdirSync(join(root, prefix)).flatMap(name => {
    const path = prefix ? `${prefix}/${name}` : name;
    const item = lstatSync(join(root, path));
    if (item.isSymbolicLink()) throw new Error('Linked CLI output is unsupported.');
    if (item.isDirectory()) return inventory(root, path);
    if (!item.isFile() || item.nlink !== 1 || item.size > 16 * 1024 * 1024) throw new Error('Unsafe CLI output.');
    return [path];
  }).sort();
}

/** Canonical bounded data bundle; verification never extracts or executes it. @param {Context} ctx @param {Buffer} [supplied] */
export function cliBundle(ctx, supplied) {
  const { sources, outputs } = cliLayout(ctx);
  const manifest = rawGit(ctx.repo, ['show', `${ctx.revision}:${ctx.prefix}package.json`]);
  const expected = ['package.json', ...outputs].sort();
  /** @type {Array<{path:string,base64:string}>} */
  let files;
  if (supplied) {
    const bundle = JSON.parse(supplied.toString('utf8'));
    if (bundle.schemaVersion !== 1 || bundle.adapter !== 'typescript-cli-npm-v1' || Object.keys(bundle).sort().join(',') !== 'adapter,files,schemaVersion' || !Array.isArray(bundle.files)) throw new Error('Invalid CLI bundle.');
    files = bundle.files;
  } else {
    const names = inventory(join(ctx.repo, ctx.prefix, 'dist')).map(path => 'dist/' + path);
    if (JSON.stringify(names) !== JSON.stringify(outputs)) throw new Error('CLI output inventory differs from the committed source layout.');
    files = expected.map(path => ({ path, base64: (path === 'package.json' ? Buffer.from(manifest) : readFileSync(join(ctx.repo, ctx.prefix, path))).toString('base64') }));
  }
  if (JSON.stringify(files.map(file => file.path)) !== JSON.stringify(expected)) throw new Error('CLI bundle must contain every expected file exactly once.');
  for (const file of files) {
    if (Object.keys(file).sort().join(',') !== 'base64,path' || typeof file.base64 !== 'string') throw new Error('Invalid CLI file entry.');
    const bytes = Buffer.from(file.base64, 'base64');
    if (!bytes.length || bytes.length > 16 * 1024 * 1024 || bytes.toString('base64') !== file.base64 || file.path === 'package.json' && !bytes.equals(Buffer.from(manifest))) throw new Error('Invalid CLI file bytes or manifest.');
    if (file.path.endsWith('.js.map')) {
      const map = JSON.parse(bytes.toString('utf8'));
      const source = sources.find(path => file.path === 'dist/' + path.slice(4, -3) + '.js.map');
      const relativeSource = source && posix.relative(posix.dirname(file.path), source);
      if (map.version !== 3 || map.file !== posix.basename(file.path, '.map') || map.sourceRoot !== '' || JSON.stringify(map.sources) !== JSON.stringify([relativeSource]) || typeof map.mappings !== 'string' || !map.mappings) throw new Error('CLI source map does not bind its committed source.');
    }
  }
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, adapter: 'typescript-cli-npm-v1', files }) + '\n');
  if (bytes.length > 16 * 1024 * 1024 || supplied && !bytes.equals(supplied)) throw new Error('CLI bundle is oversized or noncanonical.');
  return bytes;
}
