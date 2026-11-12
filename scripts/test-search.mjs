import test from 'node:test'; import assert from 'node:assert/strict'; import { norm, searchShows } from '../search.js';
const S = [{ id: 1, title: 'مسلسل اخبرهم ايها البحر الاسود', tr: 'Sen Anlat Karadeniz' }, { id: 2, title: 'مسلسل الطائر الرفراف', tr: 'Yalı Çapkını' }, { id: 3, title: 'مسلسل أزهار الثلج', tr: 'Kardelenler' }, { id: 4, title: 'مسلسل قصة عشق', tr: 'Bir Aşk Hikayesi' }, { id: 5, title: 'مسلسل الحب الأول' }, { id: 6, title: 'مسلسل حب للايجار' }];
const ids = (q) => searchShows(S, q).map((x) => x.id);
test('normalisation ignores hamza, tashkeel, tatweel, taa marbuta, digits', () => { assert.equal(norm('أَزْهَـار'), norm('ازهار')); assert.equal(norm('قصّة'), norm('قصه')); assert.equal(norm('١٢٣'), '123'); });
test('arabic variants match', () => { assert.deepEqual(ids('ازهار الثلج'), [3]); assert.deepEqual(ids('أزهار'), [3]); assert.deepEqual(ids('الحب الاول'), [5]); });
test('turkish names match, with or without diacritics and case', () => { assert.deepEqual(ids('yali capkini'), [2]); assert.deepEqual(ids('KARDELENLER'), [3]); assert.deepEqual(ids('sen anlat'), [1]); assert.deepEqual(ids('ask hikayesi'), [4]); });
test('small spelling mistakes are tolerated', () => { assert.ok(ids('kardelener').includes(3)); assert.ok(ids('الطاير الرفراف').includes(2)); });
test('best match first (exact/prefix before loose)', () => { assert.equal(ids('حب')[0], 6); assert.ok(ids('حب').includes(5)); });
test('no results gives empty list and the word مسلسل alone does not need to match everything specially', () => { assert.deepEqual(ids('zzzzqq'), []); assert.deepEqual(searchShows(S, ''), S); });
