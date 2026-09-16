// astro-src/lib/writing/validate.ts
//
// R7 WP.4: writing validation helpers.
//
// 验证 writing 对象的合法性和完整性.

import type { Writing, WritingType } from './types';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** 验证单个 writing 对象. */
export function validateWriting(writing: Writing): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 检查必填字段
  if (!writing.id || writing.id.trim() === '') {
    errors.push('缺少 id');
  }

  if (!writing.title || writing.title.trim() === '') {
    errors.push('缺少标题');
  }

  if (!writing.type) {
    errors.push('缺少写作类型');
  }

  // 检查 type 合法性
  const validTypes: WritingType[] = ['paper', 'section', 'note', 'review', 'translation'];
  if (writing.type && !validTypes.includes(writing.type)) {
    errors.push(`无效的写作类型: ${writing.type}`);
  }

  // 检查 sections
  if (!writing.sections || writing.sections.length === 0) {
    warnings.push('没有章节内容');
  } else {
    // 检查章节顺序
    for (let i = 0; i < writing.sections.length; i++) {
      if (writing.sections[i].order !== i) {
        warnings.push(`章节顺序可能不正确 (index ${i} vs order ${writing.sections[i].order})`);
        break;
      }
    }
  }

  // 检查 citedPapers
  if (!writing.citedPapers || writing.citedPapers.length === 0) {
    warnings.push('没有引用论文');
  }

  // 类型特定检查
  if (writing.type === 'paper' || writing.type === 'review') {
    // 论文/综述应该有 abstract
    const hasAbstract = writing.sections?.some((s) => s.id === 'abstract');
    if (!hasAbstract) {
      warnings.push('论文/综述建议包含摘要章节');
    }
  }

  // 检查 wordCount 合理性
  if (writing.wordCount < 0) {
    errors.push('字数不能为负');
  }

  // 检查时间戳
  if (writing.createdAt > Date.now()) {
    warnings.push('创建时间晚于当前时间');
  }

  if (writing.updatedAt < writing.createdAt) {
    errors.push('更新时间早于创建时间');
  }

  return { errors, warnings };
}

/** 验证 writing id 格式(kebab-case). */
export function validateWritingId(id: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!id || id.trim() === '') {
    errors.push('id 不能为空');
    return { errors, warnings };
  }

  // kebab-case: 只能包含小写字母、数字和连字符，不能以连字符开头/结尾
  const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!kebabCaseRegex.test(id)) {
    errors.push('id 必须是 kebab-case 格式 (小写字母、数字、连字符)');
  }

  if (id.length > 100) {
    warnings.push('id 过长，建议不超过 100 字符');
  }

  return { errors, warnings };
}

/** 验证 title 格式. */
export function validateTitle(title: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!title || title.trim() === '') {
    errors.push('标题不能为空');
    return { errors, warnings };
  }

  if (title.length > 300) {
    warnings.push('标题过长，建议不超过 300 字符');
  }

  if (title.length < 5) {
    warnings.push('标题过短');
  }

  return { errors, warnings };
}
