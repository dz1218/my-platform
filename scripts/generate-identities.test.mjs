import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DEFAULT_SOURCE, DEFAULT_OUTPUT, LEGACY_IDENTITIES, generateCatalog, validateCatalog, validateTemplates } from './generate-identities.mjs';

const templates = JSON.parse(await readFile(DEFAULT_SOURCE, 'utf8'));
const catalog = JSON.parse(await readFile(DEFAULT_OUTPUT, 'utf8'));
const cli = fileURLToPath(new URL('./generate-identities.mjs', import.meta.url));

test('checked-in catalog contains 100 occupations × 10 distinct adult women', () => {
  assert.deepEqual(validateCatalog(catalog), { occupations: 100, identities: 1000, minAge: 18, maxAge: 50 });
  assert.equal(new Set(catalog.identities.map((identity) => identity.id)).size, 1000);
  assert.equal(new Set(catalog.identities.map((identity) => identity.name)).size, 1000);
  for (const occupation of catalog.occupations) {
    const identities = catalog.identities.filter((identity) => identity.occupationCode === occupation.code);
    assert.equal(identities.length, 10, occupation.code);
    assert.equal(new Set(identities.map((identity) => identity.age)).size, 10, occupation.code);
    assert.ok(identities.every((identity) => identity.gender === 'FEMALE' && identity.age >= occupation.minAge && identity.age <= 50), occupation.code);
    assert.deepEqual(Object.keys(occupation).sort(), ['code', 'minAge', 'name']);
  }
});

test('preserves existing identities and their original introduction', () => {
  for (const legacy of LEGACY_IDENTITIES) {
    const identity = catalog.identities.find((item) => item.id === legacy.id);
    for (const field of ['id', 'name', 'age', 'city']) assert.equal(identity[field], legacy[field]);
    assert.ok(identity.background.startsWith(legacy.background));
  }
});

test('professional entry ages account for clinical, academic and training requirements', () => {
  const minimums = { doctor: 26, dentist: 26, sonographer: 26, university_lecturer: 28, veterinarian: 25, lawyer: 25, airline_pilot: 25, materials_researcher: 26, ml_researcher: 26 };
  for (const [code, minimum] of Object.entries(minimums)) {
    assert.ok(catalog.occupations.find((occupation) => occupation.code === code).minAge >= minimum, code);
    assert.ok(catalog.identities.filter((identity) => identity.occupationCode === code).every((identity) => identity.age >= minimum), code);
  }
  const metroCities = templates.occupations.find((occupation) => occupation.code === 'metro_driver').allowedCities;
  assert.ok(catalog.identities.filter((identity) => identity.occupationCode === 'metro_driver').every((identity) => metroCities.includes(identity.city)), 'metro drivers must live in a city compatible with their profession');
});

test('each occupation varies personality, voice, interests, life details and goals', () => {
  for (const occupation of catalog.occupations) {
    const identities = catalog.identities.filter((identity) => identity.occupationCode === occupation.code);
    for (const field of ['personality', 'speakingStyle', 'backstory', 'goals']) {
      assert.equal(new Set(identities.map((identity) => identity.persona[field])).size, 10, `${occupation.code}.${field}`);
    }
    assert.equal(new Set(identities.map((identity) => identity.persona.interests.join('|'))).size, 10, occupation.code);
  }
  for (const age of [28, 50]) {
    const sameAge = catalog.identities.filter((identity) => identity.age === age);
    assert.ok(new Set(sameAge.map((identity) => identity.persona.personality)).size > 8, `age ${age} must not determine personality`);
  }
});

test('personas fit the context budget and contain concrete complete authoring content', () => {
  for (const identity of catalog.identities) {
    const occupation = catalog.occupations.find((item) => item.code === identity.occupationCode);
    assert.ok(identity.persona.backstory.includes(occupation.name), identity.id);
    const prose = Object.values(identity.persona).flat().join('');
    assert.ok([...prose].length <= 600, `${identity.id}: persona too long`);
    assert.ok(!/TODO|TBD|待补充|待填写|\{\{|<placeholder>/i.test(JSON.stringify(identity)), `${identity.id}: unfinished content`);
    assert.ok(identity.background.includes(identity.city), identity.id);
  }
});

test('initial generation is deterministic and independent of template ordering', () => {
  const first = generateCatalog(templates);
  assert.deepEqual(first, generateCatalog(templates));
  assert.deepEqual(first, generateCatalog({ ...templates, occupations: [...templates.occupations].reverse() }));
  // Do not require the editable catalog to equal generated data: hand-authored improvements are valid.
});

test('rejects invalid counts, references, duplicate ages, blank text and legacy changes', () => {
  const cases = [
    [(copy) => copy.identities.pop(), /1000 identities/],
    [(copy) => { copy.identities[1].id = copy.identities[0].id; }, /duplicate or invalid identity id/],
    [(copy) => { copy.identities[1].name = copy.identities[0].name; }, /duplicate identity name/],
    [(copy) => { copy.identities[0].occupationCode = 'unknown'; }, /unknown occupation/],
    [(copy) => { copy.identities[0].age = 17; }, /age must/],
    [(copy) => { copy.identities[1].age = copy.identities[0].age; }, /ages must be distinct/],
    [(copy) => { copy.identities[0].persona.backstory = ' '; }, /trimmed nonempty/],
    [(copy) => { copy.identities[0].persona.interests = ['散步', '散步']; }, /unique entries/],
    [(copy) => { copy.identities[0].persona.careerStage = '字'.repeat(201); }, /at most 200/],
    [(copy) => { copy.identities.find((identity) => identity.id === 'identity_linwan').city = '北京'; }, /city must be preserved/],
  ];
  for (const [mutate, expected] of cases) {
    const copy = structuredClone(catalog);
    mutate(copy);
    assert.throws(() => validateCatalog(copy), expected);
  }
});

test('rejects templates unable to produce ten ages and duplicate occupations', () => {
  let copy = structuredClone(templates);
  copy.occupations[0].minAge = 42;
  assert.throws(() => validateTemplates(copy), /10 distinct adult ages/);
  copy = structuredClone(templates);
  copy.occupations[1].code = copy.occupations[0].code;
  assert.throws(() => validateTemplates(copy), /duplicate or invalid occupation code/);
});

test('CLI protects edited catalogs and --check validates without rewriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'identity-catalog-'));
  try {
    const output = join(directory, 'editable.json');
    const run = (...args) => spawnSync(process.execPath, [cli, '--output', output, ...args], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    const edited = JSON.parse(await readFile(output, 'utf8'));
    edited.identities[0].persona.personality = '安静但坦率，愿意在熟悉后分享自己的生活。';
    const text = `${JSON.stringify(edited, null, 2)}\n`;
    await writeFile(output, text);
    const protectedRun = run();
    assert.equal(protectedRun.status, 1);
    assert.match(protectedRun.stderr, /refusing to overwrite editable catalog/);
    assert.equal(await readFile(output, 'utf8'), text);
    assert.equal(run('--check').status, 0);
    assert.equal(await readFile(output, 'utf8'), text);
    assert.equal(run('--force').status, 0);
    assert.notEqual(await readFile(output, 'utf8'), text);
    assert.equal(run('--unknown').status, 1);
    assert.equal(run('--check', '--force').status, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
