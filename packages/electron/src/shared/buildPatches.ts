const UPSTREAM_URL = 'https://github.com/nimbalyst/nimbalyst';

export interface BuildPatchLink {
  number: number;
  url: string;
}

export interface BuildPatch {
  branch: string;
  sha: string;
  status?: string;
  note?: string;
  issue?: BuildPatchLink;
  pr?: BuildPatchLink;
}

export interface BuildPatches {
  base?: { sha: string; url: string };
  patches: BuildPatch[];
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function upstreamLink(value: unknown, kind: 'issues' | 'pull'): BuildPatchLink | undefined {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(number) || number <= 0) return undefined;
  return { number, url: `${UPSTREAM_URL}/${kind}/${number}` };
}

export function parseBuildPatches(raw: unknown): BuildPatches | null {
  if (!raw || typeof raw !== 'object') return null;
  const { base, patches } = raw as { base?: unknown; patches?: unknown };
  if (!Array.isArray(patches)) return null;

  const parsed = patches.flatMap((entry): BuildPatch[] => {
    const branch = text(entry?.branch);
    const sha = text(entry?.sha);
    if (!branch || !sha) return [];
    return [{
      branch,
      sha,
      status: text(entry.status),
      note: text(entry.note),
      issue: upstreamLink(entry.issue, 'issues'),
      pr: upstreamLink(entry.pr, 'pull'),
    }];
  });
  if (parsed.length === 0) return null;

  const baseSha = text(base);
  return {
    base: baseSha ? { sha: baseSha, url: `${UPSTREAM_URL}/commit/${baseSha}` } : undefined,
    patches: parsed,
  };
}
