// tests/test_user_library_highlights.test.ts — Stage 12 locate / 字段形状。
//
// 索引 / IndexedDB 行为不当单测覆盖(happy-dom 的 IDB 不可靠,本测试只
// 覆盖纯 locate 函数 + Highlight 字段约束)。

import { describe, it, expect } from 'bun:test';
import { locateHighlight, type Highlight } from '../astro-src/lib/user-library/highlights';

const h: Highlight = {
  id: 'x',
  canonicalId: '2607.00001',
  text: 'reinforcement learning',
  createdAt: 0,
};

describe('lib/user-library/highlights — locate', () => {
  it('find single occurrence', () => {
    expect(locateHighlight('this is about reinforcement learning for agents', h)).toEqual([14]);
  });

  it('find multiple occurrences', () => {
    const text = 'rl. reinforcement learning. multi-agent. reinforcement learning again.';
    expect(locateHighlight(text, h)).toEqual([4, 41]);
  });

  it('no match → empty', () => {
    expect(locateHighlight('hello world', h)).toEqual([]);
  });

  it('CJK highlight locates correctly', () => {
    const cn: Highlight = { ...h, text: '强化学习' };
    expect(locateHighlight('本文研究强化学习与多智能体协同', cn)).toEqual([4]);
  });

  it('highlight contract: required fields', () => {
    const minimal: Highlight = {
      id: 'a', canonicalId: 'b', text: 'c', createdAt: 1,
    };
    expect(minimal.id).toBeDefined();
    expect(minimal.note).toBeUndefined();
  });
});