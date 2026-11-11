'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldAppendPhotoToGroup } = require('../lib/photo-grouping');

const getText = message => message.caption || message.text || '';
const group = (anchor, photos = []) => ({ mode: 'automatic', startedAt: 1000, anchor, photos });

test('deux photos sans légende puis une photo légendée restent dans le même album', () => {
  const first = { message_id: 1, photo: [{}] };
  const second = { message_id: 2, photo: [{}] };
  const third = { message_id: 3, photo: [{}], caption: 'Légende du produit' };
  assert.equal(shouldAppendPhotoToGroup(group(first, [second]), third, 'automatic', 2000, 90000, getText), true);
});

test('une deuxième publication avec sa propre légende démarre un nouveau groupe', () => {
  const first = { message_id: 1, photo: [{}], caption: 'Premier produit' };
  const second = { message_id: 2, photo: [{}], caption: 'Deuxième produit' };
  assert.equal(shouldAppendPhotoToGroup(group(first), second, 'automatic', 2000, 90000, getText), false);
});

test('une légende sur la première photo permet encore d’ajouter les photos suivantes sans légende', () => {
  const first = { message_id: 1, photo: [{}], caption: 'Légende du produit' };
  const second = { message_id: 2, photo: [{}] };
  assert.equal(shouldAppendPhotoToGroup(group(first), second, 'automatic', 2000, 90000, getText), true);
});

test('un groupe expiré ou appartenant à un autre mode ne reçoit pas la photo', () => {
  const first = { message_id: 1, photo: [{}] };
  assert.equal(shouldAppendPhotoToGroup(group(first), { photo: [{}] }, 'manual', 2000, 90000, getText), false);
  assert.equal(shouldAppendPhotoToGroup(group(first), { photo: [{}] }, 'automatic', 91001, 90000, getText), false);
});
