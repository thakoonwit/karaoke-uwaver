const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/hits.json'), 'utf8'));

test('the supplied hit list preserves all four categories and deduplicates repeated songs', () => {
  assert.equal(catalog.sourceCount, 399);
  assert.equal(catalog.songs.length, 398);
  assert.equal(catalog.categories.length, 4);
  assert.deepEqual(catalog.categories.map(category => catalog.songs.filter(song => song.categories.includes(category.id)).length), [100, 99, 100, 100]);
  const key = song => (song.title + '|' + song.artist).normalize('NFKC').toLocaleLowerCase('th').replace(/\s+/g, ' ').trim();
  assert.equal(new Set(catalog.songs.map(key)).size, catalog.songs.length);
  assert.equal(new Set(catalog.songs.map(song => song.id)).size, catalog.songs.length);
});

test('catalog records have complete searchable metadata without invented YouTube video IDs', () => {
  const categories = new Set(catalog.categories.map(category => category.id));
  for (const song of catalog.songs) {
    assert.ok(song.title.trim()); assert.ok(song.artist.trim());
    assert.ok((song.title + ' ' + song.artist).length <= 500);
    assert.ok(song.categories.length > 0 && song.categories.every(category => categories.has(category)));
    assert.equal('videoId' in song, false);
  }
});
