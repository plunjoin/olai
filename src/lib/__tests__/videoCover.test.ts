import { describe, expect, it } from 'vitest';
import { coverCandidateTimes } from '../videoCover';

describe('video cover frame times', () => {
  it('samples the opening of the clip and never frame zero', () => {
    expect(coverCandidateTimes(8)).toEqual([0.15, 1, 2]);
    expect(coverCandidateTimes(4)).toEqual([0.15, 0.6, 1.2]);
  });

  it('keeps every candidate inside a very short clip', () => {
    const times = coverCandidateTimes(0.3);
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time).toBeLessThan(0.3);
  });

  it('falls back when the duration is unknown', () => {
    expect(coverCandidateTimes(0)).toEqual([0.2]);
    expect(coverCandidateTimes(Number.NaN)).toEqual([0.2]);
  });
});
