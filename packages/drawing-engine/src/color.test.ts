import { describe, expect, it } from 'vitest';
import { rgbToHex } from './color';

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
