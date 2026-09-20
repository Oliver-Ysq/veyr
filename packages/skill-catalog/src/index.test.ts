import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkills } from './index.js';

describe('skill catalog', () => {
  it('catalogs a project Skill with a stable static token estimate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'veyr-skill-catalog-')); const skill = join(root, '.agents', 'skills', 'demo');
    await mkdir(skill, { recursive: true }); await writeFile(join(skill, 'SKILL.md'), '---\ndescription: demo skill\n---\n' + 'abcd'.repeat(100));
    const catalog = await scanSkills(root); const entry = catalog.find((item) => item.name === 'demo');
    expect(entry).toMatchObject({ source: 'project', bodyEstimatedTokens: 108, listingEstimatedTokens: 4 });
  });
});
