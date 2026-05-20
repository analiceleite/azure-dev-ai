const STOP_WORDS = new Set([
  'a',
  'o',
  'os',
  'as',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'com',
  'um',
  'uma',
  'ao',
  'the',
  'and',
  'or',
  'to',
  'in',
  'on',
  'for',
  'with',
  'implementar',
  'implement',
  'customizado',
  'custom',
  'customizada',
  'incluir',
  'core',
  'ser',
  'foi',
  'sido',
  'esta',
  'este',
  'essa',
  'esse',
  'ao',
  'aos',
  'das',
  'dos',
  'que',
  'por',
  'como',
  'quando',
  'identificado',
  'identificada',
  'novo',
  'nova',
  'automatica',
  'automatico',
  'criacao',
  'normalizar',
  'nomes',
  'banco',
  'das',
  'dos',
  'na',
  'no',
  'ao',
  'aos'
]);

/** Palavras do título → termos extras para paths, commits e diff */
const CONCEPT_EXPANSIONS = {
  schema: [
    'schema',
    'schemaname',
    'search_path',
    'createschema',
    'provision',
    'provisioner',
    'tenantschema'
  ],
  tabelas: [
    'table',
    'migrate',
    'migration',
    'migrations',
    'efmigrations',
    'createtable',
    'ensurecreated'
  ],
  tenant: ['tenant', 'multitenancy', 'tenantcontext', 'tenancy'],
  snake: [
    'snake',
    'snake_case',
    'snakecase',
    'namingconvention',
    'usesnakecase',
    'renamecatalog',
    'renametenant'
  ],
  case: ['case', 'snake', 'naming'],
  cache: ['cache', 'modelcache', 'cachekey', 'modelcachekey'],
  factory: ['factory', 'modelcachekeyfactory'],
  chave: ['key', 'cachekey', 'modelcachekey'],
  ef: ['ef', 'efcore', 'entityframework', 'dbcontext'],
  model: ['model', 'imodel', 'modelcache'],
  key: ['key', 'cachekey']
};

function stripAccents(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function splitIdentifier(identifier) {
  return identifier
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 1);
}

function extractNamedTypes(title) {
  const matches = title.match(/\bI?[A-Z][A-Za-z0-9]+\b/g) || [];
  return matches.filter((m) => m.length > 3 && /[A-Z]/.test(m));
}

function expandTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const key = token.replace(/[^a-z0-9]/g, '');
    const synonyms = CONCEPT_EXPANSIONS[key];
    if (synonyms) {
      for (const s of synonyms) {
        expanded.add(s);
      }
    }
  }
  return [...expanded];
}

function tokenizeTitle(title) {
  const plain = stripAccents(title || '').toLowerCase();

  const raw = plain
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

  const camelParts = (title || '').match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) || [];
  const fromCamel = camelParts
    .flatMap((p) => splitIdentifier(p))
    .filter((p) => p.length > 2 && !STOP_WORDS.has(p));

  const interfaceMatch = (title || '').match(/I[A-Z][A-Za-z0-9]+/g) || [];
  const fromInterfaces = interfaceMatch.flatMap((name) => {
    const withoutI = name.startsWith('I') ? name.slice(1) : name;
    return [
      name.toLowerCase(),
      withoutI.toLowerCase(),
      ...splitIdentifier(withoutI),
      withoutI.replace(/Factory$/i, '').toLowerCase(),
      withoutI.replace(/Factory$/i, 'factory').toLowerCase()
    ];
  });

  const namedTypes = extractNamedTypes(title || '').flatMap((name) => [
    name.toLowerCase(),
    ...splitIdentifier(name)
  ]);

  const base = [...new Set([...raw, ...fromCamel, ...fromInterfaces, ...namedTypes])];
  return expandTokens(base);
}

function scoreText(text, tokens) {
  if (!text || tokens.length === 0) {
    return 0;
  }
  const haystack = stripAccents(text).toLowerCase();
  let score = 0;

  for (const token of tokens) {
    if (token.length < 3) {
      continue;
    }
    if (haystack.includes(token)) {
      score += token.length >= 10 ? 6 : token.length >= 8 ? 4 : token.length >= 5 ? 3 : 2;
    }
  }

  const compact = haystack.replace(/[^a-z0-9]/g, '');
  for (const token of tokens) {
    const compactToken = token.replace(/[^a-z0-9]/g, '');
    if (compactToken.length >= 5 && compact.includes(compactToken)) {
      score += 4;
    }
  }

  return score;
}

function extractDiffByPath(diff, paths) {
  if (!diff || paths.size === 0) {
    return new Map();
  }
  const byPath = new Map();
  const blocks = diff.split(/(?=^diff --git )/m).filter(Boolean);
  for (const block of blocks) {
    for (const p of paths) {
      if (block.includes(p) && !byPath.has(p)) {
        byPath.set(p, block.slice(0, 4000));
      }
    }
  }
  return byPath;
}

function filesFromCommits(commits, allFiles) {
  const paths = new Set();
  for (const commit of commits) {
    for (const p of commit.files || []) {
      paths.add(p);
    }
  }
  const byPath = new Map(allFiles.map((f) => [f.path, f]));
  return [...paths]
    .map((p) => byPath.get(p) || { status: '?', path: p })
    .filter(Boolean);
}

function hasStrongTypeSignal(title, filePath, diffChunk, tokens) {
  const types = extractNamedTypes(title);
  if (types.length === 0) {
    return true;
  }
  const blob = stripAccents(
    `${filePath} ${diffChunk || ''}`
  ).toLowerCase();
  const compact = blob.replace(/[^a-z0-9]/g, '');

  return types.some((typeName) => {
    const lower = typeName.toLowerCase();
    const withoutI = typeName.startsWith('I') ? typeName.slice(1) : typeName;
    const compactType = lower.replace(/[^a-z0-9]/g, '');
    return (
      blob.includes(lower) ||
      compact.includes(compactType) ||
      compact.includes(withoutI.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
  });
}

function isSchemaProvisioningTitle(tokens) {
  return (
    tokens.some((t) => t.includes('schema')) &&
    tokens.some((t) => t.includes('tenant') || t.includes('tabelas'))
  );
}

function isSnakeCaseTitle(tokens) {
  return tokens.some(
    (t) => t.includes('snake') || t === 'case' || t.includes('snakecase')
  );
}

function isModelCacheTitle(tokens) {
  return tokens.some(
    (t) =>
      t.includes('cache') ||
      t.includes('modelcache') ||
      t.includes('modelcachekey')
  );
}

function filterGitDataForTitle(gitData, title) {
  const tokens = tokenizeTitle(title || '');
  if (tokens.length === 0) {
    return gitData;
  }

  const allPaths = new Set(gitData.files.map((f) => f.path));
  const diffByPath = extractDiffByPath(gitData.diff || '', allPaths);

  const scoredCommits = gitData.commits.map((commit) => ({
    commit,
    score: scoreText(`${commit.message} ${commit.hash}`, tokens)
  }));

  const relevantCommits = scoredCommits
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.commit);

  const commits =
    relevantCommits.length > 0 ? relevantCommits : gitData.commits.slice(0, 10);

  const scoredFiles = gitData.files.map((file) => {
    const path = file.path || '';
    const base = path.split(/[/\\]/).pop() || path;
    const diffChunk = diffByPath.get(path) || '';
    let score = scoreText(`${path} ${base} ${diffChunk}`, tokens);

    if (isSchemaProvisioningTitle(tokens)) {
      if (/TenantSchemaProvisioner|ITenantSchemaProvisioner|SchemaName|AddTenantSchemaName/i.test(path)) {
        score += 8;
      }
      if (/TenantAdminService|BootstrapService|MultitenancySeeder|TenantValidationMiddleware/i.test(path)) {
        score += 4;
      }
      if (/Rename.*SnakeCase/i.test(path)) {
        score -= 6;
      }
    }

    if (isSnakeCaseTitle(tokens)) {
      if (/SnakeCase|SnakeCaseNaming|LegacyMigrationHistoryCompat/i.test(path)) {
        score += 8;
      }
      if (/Program\.cs$/i.test(path) && diffChunk.includes('SnakeCase')) {
        score += 6;
      }
      if (/TenantSchemaProvisioner/i.test(path)) {
        score -= 4;
      }
    }

    if (isModelCacheTitle(tokens)) {
      if (/TenantModelCacheKeyFactory/i.test(path)) {
        score += 12;
      }
      if (/Program\.cs$/i.test(path) && /IModelCacheKeyFactory|TenantModelCacheKeyFactory/.test(diffChunk)) {
        score += 10;
      }
      if (!hasStrongTypeSignal(title, path, diffChunk, tokens)) {
        score = Math.min(score, 2);
      }
    }

    return { file, score, diffChunk };
  });

  let relevantFiles = scoredFiles
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (relevantFiles.length > 0) {
    const maxScore = relevantFiles[0].score;
    const threshold = Math.max(3, maxScore * 0.35);
    relevantFiles = relevantFiles.filter((item) => item.score >= threshold);
    if (isModelCacheTitle(tokens)) {
      relevantFiles = relevantFiles.filter((item) =>
        hasStrongTypeSignal(title, item.file.path, item.diffChunk, tokens)
      );
    }
    if (relevantFiles.length > 15) {
      relevantFiles = relevantFiles.slice(0, 15);
    }
  }

  let files = relevantFiles.map((item) => item.file);

  if (files.length === 0 && relevantCommits.length > 0) {
    files = filesFromCommits(relevantCommits, gitData.files);
  }

  if (files.length === 0) {
    files = scoredFiles
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((i) => i.file);
  }

  const relevantPaths = new Set(files.map((f) => f.path));
  let diff = gitData.diff || '';
  if (relevantPaths.size > 0 && diff) {
    const blocks = diff.split(/(?=^diff --git )/m).filter(Boolean);
    const kept = blocks.filter((block) =>
      [...relevantPaths].some((p) => block.includes(p))
    );
    if (kept.length > 0) {
      diff = kept.join('');
    }
  }

  const strictMatchCount = scoredFiles.filter((i) => i.score > 0).length;

  return {
    ...gitData,
    commits,
    files,
    diff,
    relevance: {
      titleTokens: tokens.slice(0, 24),
      matchedCommits: relevantCommits.length,
      matchedFiles: files.length,
      strictMatchedFiles: strictMatchCount
    }
  };
}

module.exports = {
  tokenizeTitle,
  filterGitDataForTitle,
  scoreText
};
