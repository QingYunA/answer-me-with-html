// Chinese controlled writing: light-verb constructions (use the following verb directly), empty clichés (replace with concrete facts) and non-approved words (with the approved form).
// The non-approved words are the part of the Simplified Technical Chinese word list (https://github.com/mzopedia/simplified-technical-chinese) that is almost never wrong:
// typos, quantities without a number, 以上/以下/以内 after a number, one meaning one word. Context-dependent entries are left out.
export const ZH_LIGHT_VERBS = Object.freeze([
  { re: /进行(?![中时])了?([一-龥]{2})/g, label: '进行' },
  { re: /(?:加以|予以)([一-龥]{2})/g, label: '加以/予以' },
  { re: /[做作]出了?([一-龥]{2})/g, label: '做出' },
]);

export const ZH_CLICHES = Object.freeze([
  '赋能', '抓手', '闭环', '打通', '全方位', '多维度', '深度融合', '显著提升', '至关重要', '不可或缺',
  '与此同时', '综上所述', '值得注意的是', '总而言之', '众所周知', '毋庸置疑', '一站式', '底层逻辑', '颗粒度', '方法论',
]);

// Non-approved word → approved form.
const UNIT = String.raw`(?:个|次|秒|天|分钟|小时|倍|字|条|项|人|行|位|%|MB|GB|KB|TB|ms)?`;
export const ZH_WORDS = Object.freeze([
  // typos
  { re: /登陆/g, suggestion: '登录' },
  { re: /帐号/g, suggestion: '账号' },
  { re: /阀值/g, suggestion: '阈值' },
  { re: /布署/g, suggestion: '部署' },
  // quantities without a number
  { re: /尽快/g, suggestion: 'give a concrete deadline' },
  { re: /若干/g, suggestion: 'write the number' },
  { re: /大概|大约/g, suggestion: 'use "约" in descriptions, a value in steps' },
  { re: /多次/g, suggestion: 'write the count' },
  // 以上/以下/以内 after a number: it is unclear whether the endpoint is included
  { re: new RegExp(String.raw`(?<=\d\s*${UNIT}\s*)(?:以上|以下)`, 'g'), suggestion: 'name the endpoint: 大于 / 不小于, 小于 / 不大于' },
  { re: /(?<=\d[^。，；\n]{0,6})以内/g, suggestion: '不超过' },
  // one meaning, one word
  { re: /单击|点按/g, suggestion: '点击' },
  { re: /键入/g, suggestion: '输入' },
  { re: /登出/g, suggestion: '退出登录' },
  { re: /入参/g, suggestion: '参数' },
  { re: /出参/g, suggestion: '返回值' },
  { re: /缺省/g, suggestion: '默认' },
]);
