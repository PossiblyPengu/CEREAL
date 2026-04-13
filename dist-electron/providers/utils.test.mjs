import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { stripEdition, canonicalize, isDlcTitle, findExisting, makeGameEntry } = require('./utils');

describe('stripEdition', () => {
  it('removes Deluxe/Ultimate/Gold suffixes', () => {
    expect(stripEdition('Cyberpunk 2077 - Ultimate Edition')).toBe('Cyberpunk 2077');
    expect(stripEdition('Elden Ring - Deluxe Edition')).toBe('Elden Ring');
    expect(stripEdition('Hades (Gold Edition)')).toBe('Hades');
  });

  it('returns empty string for falsy input', () => {
    expect(stripEdition('')).toBe('');
    expect(stripEdition(null)).toBe('');
    expect(stripEdition(undefined)).toBe('');
  });

  it('does not alter plain names', () => {
    expect(stripEdition('Portal 2')).toBe('Portal 2');
  });
});

describe('canonicalize', () => {
  it('lowercases and strips non-alphanumeric chars', () => {
    expect(canonicalize('The Witcher 3: Wild Hunt')).toBe('the witcher 3 wild hunt');
    expect(canonicalize('DOOM Eternal')).toBe('doom eternal');
  });

  it('strips edition suffixes before canonicalizing', () => {
    expect(canonicalize('Cyberpunk 2077 - Deluxe Edition')).toBe('cyberpunk 2077');
  });

  it('returns empty string for falsy input', () => {
    expect(canonicalize('')).toBe('');
    expect(canonicalize(null)).toBe('');
  });
});

describe('isDlcTitle', () => {
  it('detects DLC keywords in title', () => {
    expect(isDlcTitle('Some Game DLC Pack')).toBe(true);
    expect(isDlcTitle('Season Pass Bundle')).toBe(true);
    expect(isDlcTitle('Expansion: Blood and Wine')).toBe(true);
  });

  it('returns false for base game titles', () => {
    expect(isDlcTitle('Elden Ring')).toBe(false);
    expect(isDlcTitle('Hades')).toBe(false);
  });

  it('detects DLC via metadata', () => {
    expect(isDlcTitle('Content Pack', { type: 'dlc' })).toBe(true);
    expect(isDlcTitle('Content Pack', { type: 'game' })).toBe(false);
  });
});

describe('findExisting', () => {
  const db = {
    games: [
      { platform: 'steam', platformId: '1091500', name: 'Cyberpunk 2077' },
      { platform: 'gog', platformId: 'gog_42', name: 'The Witcher 3: Wild Hunt' },
    ],
  };

  it('matches by platformId', () => {
    const found = findExisting(db, 'steam', '1091500', 'anything');
    expect(found).toBeTruthy();
    expect(found.name).toBe('Cyberpunk 2077');
  });

  it('matches by canonicalized name', () => {
    const found = findExisting(db, 'gog', 'different_id', 'The Witcher 3: Wild Hunt');
    expect(found).toBeTruthy();
    expect(found.platformId).toBe('gog_42');
  });

  it('returns undefined when no match', () => {
    expect(findExisting(db, 'steam', 'nope', 'No Such Game')).toBeUndefined();
  });
});

describe('makeGameEntry', () => {
  it('creates a game entry with defaults', () => {
    const entry = makeGameEntry('steam', 'steam', { name: 'Portal 2', platformId: '620' });
    expect(entry.name).toBe('Portal 2');
    expect(entry.platform).toBe('steam');
    expect(entry.platformId).toBe('620');
    expect(entry.favorite).toBe(false);
    expect(entry.categories).toEqual([]);
    expect(entry.id).toContain('steam_620_');
  });

  it('generates id from name when platformId is missing', () => {
    const entry = makeGameEntry('custom', 'custom', { name: 'My Game' });
    expect(entry.id).toContain('custom_my_game_');
    expect(entry.platformId).toBe('');
  });
});
