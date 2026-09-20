import { describe, expect, it } from 'vitest';
import { installHowTo } from './install';

const EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 Edg/140';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('install instructions', () => {
  it('points Windows browsers at the taskbar', () => {
    expect(installHowTo(EDGE).where).toBe('your taskbar');
    expect(installHowTo(EDGE).steps[0]).toMatch(/address bar/);
  });

  it('sends Firefox to a browser that can install', () => {
    expect(installHowTo(FIREFOX).steps.join(' ')).toMatch(/Edge or Chrome/);
  });

  it('knows the home screen and the Dock', () => {
    expect(installHowTo(IPHONE)).toEqual({ where: 'your home screen', steps: expect.arrayContaining([expect.stringMatching(/Add to Home Screen/)]) });
    expect(installHowTo(MAC_SAFARI).where).toBe('your Dock');
  });
});
