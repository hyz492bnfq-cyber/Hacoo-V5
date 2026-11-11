'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAppendPhotoToGroup } = require('../lib/photo-grouping');

const getText = message => message.caption || message.text || '';
const photo = (id, caption = '') => ({
  message_id: id,
  photo: [{ file_id: `photo-${id}` }],
  ...(caption ? { caption } : {})
});
const group = (anchor, photos = [], overrides = {}) => ({
  mode: 'automatic',
  startedAt: 1000,
  anchor,
  photos,
  ...overrides
});
const canAppend = (existing, incoming, options = {}) =>
  shouldAppendPhotoToGroup(
    existing,
    incoming,
    options.mode || 'automatic',
    options.now ?? 2000,
    options.windowMs ?? 90000,
    getText
  );

test('deux photos sans légende puis une troisième légendée restent dans le même album', () => {
  const first = photo(1);
  const second = photo(2);
  const third = photo(3, 'Légende du produit');
  assert.equal(canAppend(group(first, [second]), third), true);
});

test('la légende peut être sur la deuxième photo après une première photo sans texte', () => {
  assert.equal(canAppend(group(photo(1)), photo(2, 'Description')), true);
});

test('une légende sur la première photo permet les photos suivantes sans légende', () => {
  assert.equal(canAppend(group(photo(1, 'Description')), photo(2)), true);
});

test('une photo légendée après un groupe qui possède déjà une légende démarre un nouveau post', () => {
  assert.equal(canAppend(group(photo(1, 'Premier produit'), [photo(2)]), photo(3, 'Deuxième produit')), false);
});

test('une troisième légende ne rejoint pas le groupe après la première frontière', () => {
  const firstGroup = group(photo(1, 'Premier'), [photo(2)]);
  assert.equal(canAppend(firstGroup, photo(3, 'Deuxième')), false);
  const secondGroup = group(photo(3, 'Deuxième'), [], { startedAt: 2000 });
  assert.equal(canAppend(secondGroup, photo(4, 'Troisième'), { now: 2500 }), false);
});

test('plusieurs photos non légendées consécutives restent regroupables', () => {
  const first = photo(1);
  const second = photo(2);
  const third = photo(3);
  assert.equal(canAppend(group(first, [second]), third), true);
});

test('un groupe contenant une photo légendée accepte encore des photos sans légende', () => {
  const existing = group(photo(1), [photo(2, 'Légende')]);
  assert.equal(canAppend(existing, photo(3)), true);
  assert.equal(canAppend(existing, photo(4, 'Nouvelle légende')), false);
});

test('un texte/caption vide ou composé d’espaces ne crée pas une frontière', () => {
  const existing = group(photo(1), [photo(2, '   ')]);
  assert.equal(canAppend(existing, photo(3, 'Nouvelle légende')), true);
});

test('les entités ou la présence de texte ne sont pas nécessaires pour regrouper une photo', () => {
  assert.equal(canAppend(group(photo(1)), photo(2)), true);
});

test('un groupe d’un autre mode est rejeté', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { mode: 'manual' }), false);
});

test('un groupe expiré est rejeté', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: 91001 }), false);
});

test('une photo exactement à la limite temporelle est acceptée', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: 91000 }), true);
});

test('une horloge antérieure au début du groupe est rejetée', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: 999 }), false);
});

test('un message sans photo ne peut jamais être ajouté par cette fonction', () => {
  assert.equal(canAppend(group(photo(1)), { message_id: 2, text: 'texte indépendant' }), false);
});

test('un message déjà membre d’un album Telegram natif est laissé au traitement natif', () => {
  assert.equal(canAppend(group(photo(1)), { ...photo(2), media_group_id: 'native-album-1' }), false);
});

test('un groupe absent ou incomplet ne provoque pas d’erreur', () => {
  assert.equal(canAppend(null, photo(1)), false);
  assert.equal(canAppend({ mode: 'automatic', startedAt: 1000 }, photo(1)), true);
});

test('les fenêtres invalides et les horodatages invalides sont rejetés', () => {
  assert.equal(canAppend(group(photo(1)), photo(2), { now: NaN }), false);
  assert.equal(canAppend(group(photo(1)), photo(2), { windowMs: -1 }), false);
  assert.equal(shouldAppendPhotoToGroup(group(photo(1)), photo(2), 'automatic', 2000, 90000, null), true);
});

test('une publication avec une légende sur chaque photo est séparée à chaque légende', () => {
  const first = group(photo(1, 'Article A'));
  assert.equal(canAppend(first, photo(2, 'Article B')), false);
  const second = group(photo(2, 'Article B'), [], { startedAt: 2000 });
  assert.equal(canAppend(second, photo(3, 'Article C'), { now: 2500 }), false);
});


test('rafale : deux photos sans légende puis la légende 120 ms après restent ensemble', () => {
  const first = photo(101);
  const second = photo(102);
  const captionLast = photo(103, 'Publication A');
  const current = group(first, [], { startedAt: 1000 });
  assert.equal(canAppend(current, second, { now: 1120 }), true);
  current.photos.push(second);
  assert.equal(canAppend(current, captionLast, { now: 1240 }), true);
  current.photos.push(captionLast);
  assert.deepEqual([current.anchor.message_id, ...current.photos.map(item => item.message_id)], [101, 102, 103]);
});

test('rafale : deux publications légendées séparées de 150 ms ne fusionnent pas', () => {
  const firstPost = group(photo(201, 'Produit A'), [], { startedAt: 1000 });
  assert.equal(canAppend(firstPost, photo(202, 'Produit B'), { now: 1150 }), false);
});

test('rafale : une publication avec légende finale est clôturée avant la publication légendée suivante', () => {
  const firstPost = group(photo(301), [photo(302)], { startedAt: 1000 });
  assert.equal(canAppend(firstPost, photo(303, 'Produit A'), { now: 1100 }), true);
  firstPost.photos.push(photo(303, 'Produit A'));
  assert.equal(canAppend(firstPost, photo(304, 'Produit B'), { now: 1250 }), false);
});

test('limite connue : une photo sans légende du post suivant est indiscernable avant sa légende', () => {
  const firstPost = group(photo(401, 'Produit A'), [], { startedAt: 1000 });
  // Sans media_group_id, texte séparateur ou autre identifiant, la photo 402
  // peut être la suite de A ou le début de B : les métadonnées ne permettent
  // pas de trancher. La règle actuelle l'ajoute au groupe ouvert.
  assert.equal(canAppend(firstPost, photo(402), { now: 1100 }), true);
});
