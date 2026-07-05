import { describe, expect, it } from 'vitest';
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb } from './color';

describe('rgbToHex', () => {
  it('converts pure colors correctly', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#FFFFFF');
    expect(rgbToHex(229, 57, 53)).toBe('#E53935'); // matches BUILT_IN_PALETTE's red
  });

  it('pads single-digit hex components with a leading zero', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  it('clamps and rounds out-of-range or fractional input', () => {
    expect(rgbToHex(-10, 300, 127.6)).toBe('#00FF80');
  });
});

describe('hexToRgb', () => {
  it('parses a hex string back into its rgb components', () => {
    expect(hexToRgb('#E53935')).toEqual({ r: 229, g: 57, b: 53 });
  });

  it('round-trips through rgbToHex', () => {
    expect(hexToRgb(rgbToHex(229, 57, 53))).toEqual({ r: 229, g: 57, b: 53 });
  });
});

describe('rgbToHsb', () => {
  it('converts pure hues correctly', () => {
    expect(rgbToHsb(255, 0, 0)).toEqual({ h: 0, s: 100, v: 100 });
    expect(rgbToHsb(0, 255, 0)).toEqual({ h: 120, s: 100, v: 100 });
    expect(rgbToHsb(0, 0, 255)).toEqual({ h: 240, s: 100, v: 100 });
    expect(rgbToHsb(0, 255, 255)).toEqual({ h: 180, s: 100, v: 100 });
  });

  it('is achromatic (s=0) for any gray, regardless of hue', () => {
    expect(rgbToHsb(128, 128, 128)).toEqual({ h: 0, s: 0, v: 50 });
    expect(rgbToHsb(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsb(255, 255, 255)).toEqual({ h: 0, s: 0, v: 100 });
  });
});

describe('hsbToRgb', () => {
  it('converts known hsb values to rgb', () => {
    expect(hsbToRgb(0, 100, 100)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsbToRgb(120, 100, 100)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsbToRgb(240, 100, 100)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('wraps hue at 360 back to 0', () => {
    expect(hsbToRgb(360, 100, 100)).toEqual(hsbToRgb(0, 100, 100));
  });

  it('handles negative hue input defensively', () => {
    expect(hsbToRgb(-120, 100, 100)).toEqual(hsbToRgb(240, 100, 100));
  });
});

describe('rgb <-> hsb round-trip', () => {
  it('recovers the original rgb within rounding tolerance for a spread of colors', () => {
    const samples: Array<[number, number, number]> = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255],
      [229, 57, 53], [30, 144, 255], [128, 128, 128], [10, 200, 90],
    ];
    for (const [r, g, b] of samples) {
      const { h, s, v } = rgbToHsb(r, g, b);
      const back = hsbToRgb(h, s, v);
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(2);
    }
  });
});
