import { describe, it, expect, beforeEach } from 'vitest';
import { POI_SCHLUESSEL } from '@yapaia/shared';
import { useStyleStore, wirksamesPoiAus, STANDARD_POI_CHIPS } from './styleStore.js';
import { DEFAULT_STYLE_OPTIONS } from '../map/styleClient.js';

describe('POI-Chips', () => {
  beforeEach(() => {
    useStyleStore.setState({ options: DEFAULT_STYLE_OPTIONS, poiChips: [...STANDARD_POI_CHIPS], chipFilter: [] });
  });

  it('ohne aktiven Chip gilt die Auswahl aus den Einstellungen', () => {
    expect(wirksamesPoiAus(['poi-essen'], [])).toEqual(['poi-essen']);
  });

  it('der Wunsch: „nur die POIs der aktivierten Chips werden angezeigt"', () => {
    const aus = wirksamesPoiAus([], ['poi-tanken', 'poi-wohnmobil']);
    expect(aus).not.toContain('poi-tanken');
    expect(aus).not.toContain('poi-wohnmobil');
    expect(aus.length).toBe(POI_SCHLUESSEL.length - 2);
  });

  it('ein Chip schaltet an und wieder aus, ohne die Einstellung zu ändern', () => {
    useStyleStore.getState().toggleChip('poi-tanken');
    expect(useStyleStore.getState().chipFilter).toEqual(['poi-tanken']);
    useStyleStore.getState().toggleChip('poi-tanken');
    expect(useStyleStore.getState().chipFilter).toEqual([]);
    expect(useStyleStore.getState().options.poiAus).toEqual([]);
  });

  it('wird ein aktiver Chip aus der Kopfzeile genommen, filtert er nicht unsichtbar weiter', () => {
    useStyleStore.getState().toggleChip('poi-tanken');
    useStyleStore.getState().setPoiChip('poi-tanken', false);
    expect(useStyleStore.getState().poiChips).not.toContain('poi-tanken');
    expect(useStyleStore.getState().chipFilter).toEqual([]);
  });

  it('nur bekannte Kategorien werden zu Chips', () => {
    useStyleStore.getState().setPoiChip('poi-gibtsnicht', true);
    expect(useStyleStore.getState().poiChips).not.toContain('poi-gibtsnicht');
  });
});
