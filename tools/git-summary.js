const path = require('path');
const simpleGit = require('simple-git');

const MAX_DIFF_CHARS = 16000;

function resolveRepoPath(repoPath) {
  const resolved = path.resolve(
    repoPath || process.env.GIT_REPO_PATH || process.cwd()
  );
  return resolved;
}

function truncateDiff(diff) {
  if (!diff || diff.length <= MAX_DIFF_CHARS) {
    return diff || '';
  }
  return (
    diff.slice(0, MAX_DIFF_CHARS) +
    '\n\n... [diff truncado — alterações adicionais omitidas]'
  );
}

function parseNameStatus(output) {
  if (!output || !output.trim()) {
    return [];
  }

  return output
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        return { status: parts[0], path: parts.slice(1).join('\t') };
      }
      return { status: '?', path: line };
    });
}

function mergeFileLists(...lists) {
  const byPath = new Map();
  for (const list of lists) {
    for (const file of list) {
      byPath.set(file.path, file);
    }
  }
  return [...byPath.values()];
}

async function revParse(git, ref) {
  const sha = await git.raw(['rev-parse', '--verify', ref]).catch(() => null);
  return sha?.trim() || null;
}

async function isAncestor(git, ancestor, descendant) {
  try {
    await git.raw(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

async function tryForkPoint(git, upstreamRef, displayLabel) {
  const forkPoint = (
    await git
      .raw(['merge-base', '--fork-point', upstreamRef, 'HEAD'])
      .catch(() => '')
  ).trim();
  if (!forkPoint) {
    return null;
  }

  const commitCount = await countCommitsInRange(git, forkPoint);
  if (commitCount === 0) {
    return null;
  }

  return {
    label: displayLabel || upstreamRef,
    sha: forkPoint,
    mergeBase: forkPoint,
    compareKind: 'fork-point',
    commitCount
  };
}

async function countCommitsInRange(git, mergeBase) {
  const count = (
    await git.raw(['rev-list', '--count', `${mergeBase}..HEAD`]).catch(() => '0')
  ).trim();
  return parseInt(count, 10) || 0;
}

async function tryMergeBase(git, baseRef, baseLabel) {
  const baseSha = await revParse(git, baseRef);
  if (!baseSha) {
    return null;
  }

  let mergeBase = (
    await git.raw(['merge-base', baseSha, 'HEAD']).catch(() => '')
  ).trim();

  if (!mergeBase && (await isAncestor(git, baseSha, 'HEAD'))) {
    mergeBase = baseSha;
  }

  if (!mergeBase) {
    return null;
  }

  const commitCount = await countCommitsInRange(git, mergeBase);
  if (commitCount === 0) {
    return null;
  }

  return {
    label: baseLabel || baseRef,
    sha: baseSha,
    mergeBase,
    compareKind: 'merge-base',
    commitCount
  };
}

/**
 * Define o ponto inicial do diff para documentar a branch atual.
 * Por defeito: upstream da branch → fork-point → origin/<branch> → origin/main.
 * GIT_BASE_BRANCH=auto (ou vazio) activa esta detecção.
 */
async function resolveCompareBase(git, currentBranch, preferred) {
  const normalized = (preferred || 'auto').trim().toLowerCase();
  const isAuto =
    !normalized || normalized === 'auto' || normalized === 'current';

  const branchStartLabel = `${currentBranch} (início do trabalho na branch)`;

  if (isAuto) {
    for (const integrationRef of ['origin/main', 'origin/master', 'main', 'master']) {
      const merged = await tryMergeBase(git, integrationRef, branchStartLabel);
      if (merged) {
        return merged;
      }
    }

    const upstream = (
      await git.raw(['rev-parse', '--abbrev-ref', '@{upstream}']).catch(() => '')
    ).trim();

    if (upstream && upstream !== `origin/${currentBranch}`) {
      const fork = await tryForkPoint(
        git,
        upstream,
        `${currentBranch} (desde ${upstream})`
      );
      if (fork) {
        return fork;
      }

      const merged = await tryMergeBase(git, upstream, `${currentBranch} (desde ${upstream})`);
      if (merged) {
        return merged;
      }
    }

    for (const ref of [`origin/${currentBranch}`, currentBranch]) {
      const fork = await tryForkPoint(git, ref, branchStartLabel);
      if (fork) {
        return fork;
      }
    }
  } else {
    const refs =
      preferred === 'main' || preferred === 'master'
        ? [`origin/${preferred}`, preferred]
        : [preferred];

    if (
      preferred === currentBranch ||
      preferred === `origin/${currentBranch}`
    ) {
      for (const integrationRef of ['origin/main', 'origin/master']) {
        const merged = await tryMergeBase(git, integrationRef, branchStartLabel);
        if (merged) {
          return merged;
        }
      }

      for (const ref of refs) {
        const fork = await tryForkPoint(git, ref, branchStartLabel);
        if (fork) {
          return fork;
        }
      }
    }

    for (const ref of refs) {
      const merged = await tryMergeBase(git, ref, branchStartLabel);
      if (merged) {
        return merged;
      }
    }
  }

  for (const fallback of ['origin/main', 'origin/master']) {
    const merged = await tryMergeBase(git, fallback, branchStartLabel);
    if (merged) {
      return merged;
    }
  }

  throw new Error(
    `Não foi possível calcular o início das alterações na branch "${currentBranch}". ` +
      'Configure upstream (git branch -u origin/fix/tenant) ou GIT_BASE_BRANCH.'
  );
}

async function getGitSummary(repoPath) {
  const resolvedPath = resolveRepoPath(repoPath);
  const git = simpleGit({ baseDir: resolvedPath });

  const insideWorkTree = await git
    .raw(['rev-parse', '--is-inside-work-tree'])
    .catch(() => null);

  if (insideWorkTree?.trim() !== 'true') {
    throw new Error(
      `O caminho "${resolvedPath}" não é um repositório Git válido. ` +
        'Configure GIT_REPO_PATH no MCP ou passe repoPath na tool.'
    );
  }

  const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  const compare = await resolveCompareBase(
    git,
    branch,
    process.env.GIT_BASE_BRANCH
  );

  const mergeBase = compare.mergeBase;
  const logRange = `${mergeBase}..HEAD`;
  const diffRange = logRange;
  const mergeBaseShort = mergeBase.slice(0, 8);

  const includeWorkingTree = process.env.GIT_INCLUDE_WORKING_TREE !== 'false';

  const [
    logResult,
    branchNameStatus,
    branchDiffStat,
    branchDiffText,
    workingNameStatus,
    workingDiffText
  ] = await Promise.all([
    git.log([logRange, '--no-merges', '-n', '30']).catch(() => ({ all: [] })),
    git.diff(['--name-status', diffRange]).catch(() => ''),
    git.diffSummary([diffRange]).catch(() => ({
      files: [],
      insertions: 0,
      deletions: 0
    })),
    git.diff([diffRange]).catch(() => ''),
    includeWorkingTree
      ? git.diff(['--name-status', 'HEAD']).catch(() => '')
      : Promise.resolve(''),
    includeWorkingTree ? git.diff(['HEAD']).catch(() => '') : Promise.resolve('')
  ]);

  const nameOnlyLog = await git
    .raw([
      'log',
      logRange,
      '--no-merges',
      '-n',
      '30',
      '--name-only',
      '--pretty=format:@@@%H@@@%s'
    ])
    .catch(() => '');

  const filesByCommitHash = new Map();
  if (nameOnlyLog?.trim()) {
    let currentHash = null;
    for (const line of nameOnlyLog.split('\n')) {
      const header = line.match(/^@@@([0-9a-f]+)@@@(.*)$/);
      if (header) {
        currentHash = header[1].slice(0, 8);
        filesByCommitHash.set(currentHash, []);
        continue;
      }
      const filePath = line.trim();
      if (currentHash && filePath) {
        filesByCommitHash.get(currentHash).push(filePath);
      }
    }
  }

  const commits = (logResult.all || []).map((entry) => {
    const shortHash = entry.hash?.slice(0, 8) || '';
    return {
      hash: shortHash,
      message: entry.message || '',
      author: entry.author_name || '',
      date: entry.date || '',
      files: filesByCommitHash.get(shortHash) || []
    };
  });

  const branchFiles = parseNameStatus(branchNameStatus);
  const workingFiles = parseNameStatus(workingNameStatus);
  const files = mergeFileLists(branchFiles, workingFiles);

  const diffParts = [];
  if (branchDiffText?.trim()) {
    diffParts.push(
      `# Diff na branch ${branch} (${mergeBaseShort}..HEAD)\n${branchDiffText}`
    );
  }
  if (workingDiffText?.trim()) {
    diffParts.push(`# Alterações locais não commitadas (vs HEAD)\n${workingDiffText}`);
  }

  const stats = {
    insertions: branchDiffStat.insertions ?? 0,
    deletions: branchDiffStat.deletions ?? 0,
    filesChanged: files.length
  };

  return {
    repoPath: resolvedPath,
    branch,
    baseBranch: compare.label,
    compareFrom: mergeBaseShort,
    compareMode: 'current-branch',
    commits,
    files,
    diff: truncateDiff(diffParts.join('\n\n')),
    stats,
    scopeNote:
      `Contexto Git: branch de trabalho "${branch}" — commits e arquivos desde ${mergeBaseShort} ` +
      `(${compare.compareKind}: início das alterações desta branch). ` +
      'Documente só o que pertence a esta branch, não outras branches.'
  };
}

module.exports = {
  getGitSummary,
  resolveRepoPath,
  truncateDiff,
  resolveCompareBase
};
