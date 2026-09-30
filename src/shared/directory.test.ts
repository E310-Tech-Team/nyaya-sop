import { describe, expect, it } from 'vitest';
import { NIGERIAN_STATES } from './application';
import { cleanName, displayName, parishKey, stateFromProvince, unitKey } from './directory';

describe('cleanName', () => {
  it('decodes entities, including the double-encoded ones in the RCCG list', () => {
    expect(cleanName('GOODNESS &amp; MERCY')).toBe('GOODNESS & MERCY');
    expect(cleanName('ARISE &AMP; SHINE')).toBe('ARISE & SHINE');
    expect(cleanName('HOUSE OF PRAYER (YOUNG ADULT &amp;amp; YOUTH MEGA)')).toBe('HOUSE OF PRAYER (YOUNG ADULT & YOUTH MEGA)');
    expect(cleanName('A &#38; B &#x26; C')).toBe('A & B & C');
    expect(cleanName('KEEP &unknown; AS IS')).toBe('KEEP &unknown; AS IS');
  });

  it('turns escaped, curly and backtick apostrophes into plain ones', () => {
    expect(cleanName("GOD\\'S GIFT PARISH")).toBe("GOD'S GIFT PARISH");
    expect(cleanName("GOD\\\\\\'S PAVILION")).toBe("GOD'S PAVILION");
    expect(cleanName("RULERS \\' HOUSE (HAUSA PARISH)")).toBe("RULERS' HOUSE (HAUSA PARISH)");
    expect(cleanName('KING’S COURT')).toBe("KING'S COURT");
    expect(cleanName('KING`S COURT')).toBe("KING'S COURT");
  });

  it('collapses spaces and tabs and drops control characters', () => {
    expect(cleanName('  KING\\\'S    ARENA \t PARISH ')).toBe("KING'S ARENA PARISH");
    expect(cleanName('GRACE\u007f CHAPEL�')).toBe('GRACE CHAPEL');
  });
});

describe('keys', () => {
  it('match units written in different capitals or spacing', () => {
    expect(unitKey('LAGOS pROVINCE 102')).toBe(unitKey('Lagos  Province 102'));
    expect(unitKey('Region 5')).toBe('REGION 5');
  });

  it('match parishes with or without RCCG, Parish, apostrophes or ampersands', () => {
    expect(parishKey('RCCG, DIVINE FAVOUR PARISH')).toBe('DIVINE FAVOUR');
    expect(parishKey('The RCCG Divine Favour')).toBe('DIVINE FAVOUR');
    expect(parishKey('R.C.C.G. Divine Favour')).toBe('DIVINE FAVOUR');
    expect(parishKey("KING'S COURT")).toBe(parishKey('KINGS COURT'));
    expect(parishKey('PRAYER & PRAISE')).toBe(parishKey('PRAYER AND PRAISE'));
    expect(parishKey('GOODNESS &amp; MERCY')).toBe('GOODNESS AND MERCY');
  });

  it('keep notes in brackets, which can tell parishes apart', () => {
    expect(parishKey('DOUBLE PORTION(UNREGISTERED PARISH)')).toBe('DOUBLE PORTION UNREGISTERED');
    expect(parishKey('DOUBLE PORTION')).not.toBe(parishKey('DOUBLE PORTION (UNREGISTERED)'));
  });

  it('never strip a name down to nothing', () => {
    expect(parishKey('RCCG PARISH')).toBe('PARISH');
    expect(parishKey('RCCG')).toBe('RCCG');
    expect(parishKey('Parish')).toBe('PARISH');
  });
});

describe('displayName', () => {
  it('uses ordinary capitals', () => {
    expect(displayName('JESUS HOUSE')).toBe('Jesus House');
    expect(displayName('HOUSE OF PRAYER')).toBe('House of Prayer');
    expect(displayName('LAGOS pROVINCE 102')).toBe('Lagos Province 102');
    expect(displayName('ABASI MKPAIDEM PARISH (GOD OF WONDERS)')).toBe('Abasi Mkpaidem Parish (God of Wonders)');
  });

  it('keeps acronyms, Roman numerals and ordinals', () => {
    expect(displayName('RCCG KING\\\'S COURT')).toBe("RCCG King's Court");
    expect(displayName('FCT PROVINCE 22 MAIN')).toBe('FCT Province 22 Main');
    expect(displayName('CHRIST CHAPEL II')).toBe('Christ Chapel II');
    expect(displayName('2ND COVENANT ASSEMBLY')).toBe('2nd Covenant Assembly');
    expect(displayName('REGION 35 HQ')).toBe('Region 35 HQ');
  });

  it('starts a new word after a bracket or hyphen', () => {
    expect(displayName('EL-SHADDAI')).toBe('El-Shaddai');
    expect(displayName('THE LIGHT (OF THE WORLD)')).toBe('The Light (Of the World)');
    expect(displayName('LIVELY STONES ASSEMBLY (YOUTH PARISH)')).toBe('Lively Stones Assembly (Youth Parish)');
  });
});

describe('stateFromProvince', () => {
  it('reads the state from the start of the province name', () => {
    expect(stateFromProvince('LAGOS PROVINCE 12')).toBe('Lagos');
    expect(stateFromProvince('AKWA IBOM PROVINCE 3')).toBe('Akwa Ibom');
    expect(stateFromProvince('ADAMAWA PROVINCE')).toBe('Adamawa');
    expect(stateFromProvince('KWARA 2')).toBe('Kwara');
    expect(stateFromProvince('FCT PROVINCE 22 MAIN')).toBe('FCT (Abuja)');
    expect(stateFromProvince('NIGER PROVINCE 2')).toBe('Niger');
  });

  it('accepts the other spellings in the RCCG list', () => {
    expect(stateFromProvince('CROSS RIVERS 9')).toBe('Cross River');
    expect(stateFromProvince('CROSS RIVER PROVINCE 1')).toBe('Cross River');
    expect(stateFromProvince('NASSARAWA PROVINCE 1')).toBe('Nasarawa');
  });

  it('finds every state', () => {
    for (const state of NIGERIAN_STATES) {
      const name = state === 'FCT (Abuja)' ? 'FCT PROVINCE 1' : `${state.toUpperCase()} PROVINCE 1`;
      expect(stateFromProvince(name), name).toBe(state);
    }
  });

  it('returns null when the name has no state', () => {
    expect(stateFromProvince('YOUTH PROVINCE 3')).toBeNull();
    expect(stateFromProvince('PROVINCE 106')).toBeNull();
    expect(stateFromProvince('REDEMPTION CITY PROVINCE')).toBeNull();
    expect(stateFromProvince('NIGERIA WIDE')).toBeNull();
  });
});
