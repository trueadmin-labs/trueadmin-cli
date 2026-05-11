export const objectValue = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export const stringValue = (value, fallback) =>
  typeof value === 'string' && value !== '' ? value : fallback;

export const stringList = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item !== '') : [];

export const trimLeadingSlash = (value) => value.replace(/^\/+/, '');

export const backendRelativePath = (value) => {
  const normalized = trimLeadingSlash(value);
  return normalized.startsWith('backend/') ? normalized.slice('backend/'.length) : normalized;
};

export const quotePhp = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const quoteTs = quotePhp;

export const tsProperty = (key) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quoteTs(key);

export const exportPhp = (value, level = 0) => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const indent = ' '.repeat((level + 1) * 4);
    const closing = ' '.repeat(level * 4);
    return `[\n${value.map((item) => `${indent}${exportPhp(item, level + 1)},`).join('\n')}\n${closing}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '[]';
    }
    const indent = ' '.repeat((level + 1) * 4);
    const closing = ' '.repeat(level * 4);
    return `[\n${entries
      .map(([key, item]) => `${indent}${quotePhp(key)} => ${exportPhp(item, level + 1)},`)
      .join('\n')}\n${closing}]`;
  }

  if (typeof value === 'string' && value.startsWith('BACKEND_BASE_PATH:')) {
    return `BASE_PATH . ${quotePhp('/' + trimLeadingSlash(value.slice('BACKEND_BASE_PATH:'.length)))}`;
  }
  if (typeof value === 'string') {
    return quotePhp(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }

  return 'null';
};

export const exportTs = (value, level = 0) => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const indent = ' '.repeat((level + 1) * 2);
    const closing = ' '.repeat(level * 2);
    return `[\n${value.map((item) => `${indent}${exportTs(item, level + 1)},`).join('\n')}\n${closing}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return '{}';
    }
    const indent = ' '.repeat((level + 1) * 2);
    const closing = ' '.repeat(level * 2);
    return `{\n${entries
      .map(([key, item]) => `${indent}${tsProperty(key)}: ${exportTs(item, level + 1)},`)
      .join('\n')}\n${closing}}`;
  }

  if (typeof value === 'string') {
    return quoteTs(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }

  return 'null';
};
