// 用户配置：~/.answer-me-with-html/config.json（AM_HOME 可改位置）。
// 只保存用户显式设置过的键；读取时与默认值合并，坏文件 / 非法值一律回退默认，不让配置问题挡住渲染。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { CHOICES, VOICES } from './parse.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const CONFIG_KEYS = Object.freeze({
  open: { type: 'bool', default: true, label: '生成后自动用浏览器打开页面' },
  always: { type: 'bool', default: true, label: '高频模式：给结论时都附一页（需安装 answer-me-with-html-always 插件）' },
  theme: { type: 'enum', choices: CHOICES.theme, default: 'blueprint', label: '默认主题' },
  mode: { type: 'enum', choices: CHOICES.mode, default: 'auto', label: '默认明暗模式' },
  style: { type: 'enum', choices: CHOICES.style, default: '80', label: 'STE 写作检查严格度' },
  update_check: { type: 'bool', default: true, label: '每周在后台检查一次新版本，有新版本时提示（不会自动更新）' },
  voice: { type: 'enum', choices: VOICES, default: 'auto', label: '视频旁白配音（auto：有 ELEVENLABS_API_KEY 用 ElevenLabs，否则用系统 TTS；local：AM_TTS_URL 指向的本地服务）' },
});

const TRUE = new Set(['on', 'true', 'yes', '1', '开', '开启', '打开']);
const FALSE = new Set(['off', 'false', 'no', '0', '关', '关闭']);

export function amHome(env = process.env) {
  return env.AM_HOME || join(homedir(), '.answer-me-with-html');
}

export function configPath(env = process.env) {
  return join(amHome(env), 'config.json');
}

const defaults = () => Object.fromEntries(Object.entries(CONFIG_KEYS).map(([k, s]) => [k, s.default]));

function coerce(key, raw) {
  const spec = CONFIG_KEYS[key];
  if (!spec) throw new ConfigError(`没有配置项 "${key}"。可用：${Object.keys(CONFIG_KEYS).join(' | ')}`);
  if (spec.type === 'bool') {
    if (typeof raw === 'boolean') return raw;
    const v = String(raw).trim().toLowerCase();
    if (TRUE.has(v)) return true;
    if (FALSE.has(v)) return false;
    throw new ConfigError(`${key} 只接受 on / off`);
  }
  const v = String(raw).trim();
  if (!spec.choices.includes(v)) throw new ConfigError(`${key} 的值 "${v}" 无效，可选：${spec.choices.join(' | ')}`);
  return v;
}

function readStored(env) {
  const file = configPath(env);
  if (!existsSync(file)) return { stored: {} };
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { stored: data && typeof data === 'object' && !Array.isArray(data) ? data : {} };
  } catch (e) {
    return { stored: {}, warning: `${file} 无法解析，已使用默认配置（${e.message}）` };
  }
}

export function readConfig(env = process.env) {
  const { stored, warning } = readStored(env);
  const values = defaults();
  for (const [k, v] of Object.entries(stored)) {
    if (!CONFIG_KEYS[k]) continue;
    try {
      values[k] = coerce(k, v);
    } catch {
      // 非法值保持默认。
    }
  }
  return { values, stored, warning, path: configPath(env) };
}

function writeStored(stored, env) {
  const file = configPath(env);
  if (!Object.keys(stored).length) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
}

export function setConfig(key, raw, env = process.env) {
  const value = coerce(key, raw);
  const { stored } = readStored(env);
  writeStored({ ...stored, [key]: value }, env);
  return value;
}

export function resetConfig(key, env = process.env) {
  if (key !== undefined && !CONFIG_KEYS[key]) coerce(key, '');
  const { stored } = readStored(env);
  const next = key === undefined ? {} : Object.fromEntries(Object.entries(stored).filter(([k]) => k !== key));
  writeStored(next, env);
}
