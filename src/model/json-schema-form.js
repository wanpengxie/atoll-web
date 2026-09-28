// JSON Schema 表单的纯函数一半：把一个对象 schema 读成字段表、给出输入框初值、
// 把输入框里的文本校验并还原成 schema 声明的类型。
//
// 只认对象 schema 的一层 properties：type / title / description / default /
// enum / examples / required，外加 string 的 pattern/minLength/maxLength 和
// number 的 minimum/maximum。嵌套的 object/array 退化成一个 JSON 文本框——
// 表单是给人填几个值的，不是 schema 编辑器。

const EMPTY = Object.freeze([]);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function schemaType(property) {
  const declared = Array.isArray(property.type)
    ? property.type.find((type) => type !== 'null')
    : property.type;
  if (typeof declared === 'string' && declared) return declared;
  if (Array.isArray(property.enum) && property.enum.length) {
    const first = property.enum.find((value) => value != null);
    if (typeof first === 'boolean') return 'boolean';
    if (typeof first === 'number') return Number.isInteger(first) ? 'integer' : 'number';
  }
  return 'string';
}

function controlOf(type, property, secret) {
  if (Array.isArray(property.enum) && property.enum.length && !secret) return 'select';
  if (type === 'boolean') return 'checkbox';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'object' || type === 'array') return 'json';
  return secret ? 'password' : 'text';
}

// secret：这些字段画成密码框。它们的值只由调用方写进它该去的地方，恒不回显。
export function schemaFields(schema, { secret = EMPTY } = {}) {
  if (!plainObject(schema) || !plainObject(schema.properties)) return EMPTY;
  const secretFields = new Set(secret);
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.freeze(Object.entries(schema.properties)
    .filter(([name, property]) => name && plainObject(property))
    .map(([name, property]) => {
      const isSecret = secretFields.has(name);
      const type = schemaType(property);
      return Object.freeze({
        name,
        type,
        control: controlOf(type, property, isSecret),
        label: String(property.title || name),
        description: typeof property.description === 'string' ? property.description : '',
        required: required.has(name),
        secret: isSecret,
        ...(Array.isArray(property.enum) ? { enum: Object.freeze([...property.enum]) } : {}),
        ...(Object.hasOwn(property, 'default') ? { default: property.default } : {}),
        ...(Array.isArray(property.examples) && property.examples.length ? { examples: Object.freeze([...property.examples]) } : {}),
        ...(typeof property.pattern === 'string' ? { pattern: property.pattern } : {}),
        ...(Number.isFinite(property.minLength) ? { minLength: property.minLength } : {}),
        ...(Number.isFinite(property.maxLength) ? { maxLength: property.maxLength } : {}),
        ...(Number.isFinite(property.minimum) ? { minimum: property.minimum } : {}),
        ...(Number.isFinite(property.maximum) ? { maximum: property.maximum } : {}),
      });
    }));
}

// select 的 option value 恒是字符串；用枚举项的 JSON 拼写，既能区分 1 和 "1"，
// 又能从选中的字符串原样还原。
export function enumOptionValue(value) {
  return JSON.stringify(value);
}

function inputValue(field, value) {
  if (value === undefined || value === null) return field.control === 'checkbox' ? false : '';
  if (field.control === 'checkbox') return value === true;
  if (field.control === 'select') return enumOptionValue(value);
  if (field.control === 'json') {
    try { return JSON.stringify(value, null, 2); } catch { return ''; }
  }
  return String(value);
}

// 初值：请求给的 values 优先，其次 schema 的 default；都没有就是空。
export function initialFormValues(fields, prefill = {}) {
  const source = plainObject(prefill) ? prefill : {};
  const values = {};
  for (const field of fields || EMPTY) {
    const value = Object.hasOwn(source, field.name) ? source[field.name] : field.default;
    values[field.name] = inputValue(field, value);
  }
  return values;
}

function emptyInput(field, raw) {
  if (field.control === 'checkbox') return false;
  return raw === undefined || raw === null || String(raw).trim() === '';
}

function validateString(field, text) {
  if (Number.isFinite(field.minLength) && text.length < field.minLength) return `至少 ${field.minLength} 个字符`;
  if (Number.isFinite(field.maxLength) && text.length > field.maxLength) return `最多 ${field.maxLength} 个字符`;
  if (field.pattern) {
    let pattern;
    try { pattern = new RegExp(field.pattern); } catch { pattern = null; }
    if (pattern && !pattern.test(text)) return '格式不符合要求';
  }
  return '';
}

function convert(field, raw) {
  if (field.control === 'checkbox') return { value: raw === true };
  if (field.control === 'select') {
    const option = (field.enum || EMPTY).find((candidate) => enumOptionValue(candidate) === raw);
    if (option === undefined) return { error: '请选择一个可选值' };
    return { value: option };
  }
  if (field.control === 'number') {
    const value = Number(String(raw).trim());
    if (!Number.isFinite(value)) return { error: '请输入数字' };
    if (field.type === 'integer' && !Number.isInteger(value)) return { error: '请输入整数' };
    if (Number.isFinite(field.minimum) && value < field.minimum) return { error: `不能小于 ${field.minimum}` };
    if (Number.isFinite(field.maximum) && value > field.maximum) return { error: `不能大于 ${field.maximum}` };
    return { value };
  }
  if (field.control === 'json') {
    let value;
    try { value = JSON.parse(String(raw)); } catch { return { error: 'JSON 格式无效' }; }
    if (field.type === 'array' && !Array.isArray(value)) return { error: '必须是 JSON 数组' };
    if (field.type === 'object' && !plainObject(value)) return { error: '必须是 JSON 对象' };
    return { value };
  }
  // text / password：密钥按原样收，不裁剪——值是什么就写什么。
  const text = field.secret ? String(raw) : String(raw).trim();
  const error = validateString(field, text);
  if (error) return { error };
  if (Array.isArray(field.enum) && field.enum.length && !field.enum.includes(text)) return { error: '不是可选值之一' };
  return { value: text };
}

// 返回 { values, errors }。空着的可选字段不出现在 values 里；布尔字段恒有值。
export function validateFormValues(fields, raw = {}) {
  const input = plainObject(raw) ? raw : {};
  const values = {};
  const errors = {};
  for (const field of fields || EMPTY) {
    const current = input[field.name];
    if (emptyInput(field, current)) {
      if (field.control === 'checkbox') values[field.name] = false;
      else if (field.required) errors[field.name] = '必填';
      continue;
    }
    const result = convert(field, current);
    if (result.error) errors[field.name] = result.error;
    else values[field.name] = result.value;
  }
  return Object.freeze({ values, errors, valid: Object.keys(errors).length === 0 });
}
