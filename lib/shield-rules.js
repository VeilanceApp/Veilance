const MAX_MANAGED_SHIELD_RULES = 500;
const MAX_SHIELD_DOCUMENT_BYTES = 64 * 1024;
const MAX_MATCH_ACTIONS = 8;
const MAX_MATCH_DETAILS = 8;

export const SUPPORTED_SHIELD_STRATEGIES = Object.freeze([
  "binary-number",
  "bucket-number",
  "cap-number",
  "canvas-pixel-farbling",
  "float-array-farbling",
  "replace-number",
  "replace-string",
  "text-metrics-farbling",
  "typed-array-farbling"
]);

const SUPPORTED_STRATEGY_SET = new Set(SUPPORTED_SHIELD_STRATEGIES);

function cleanText(value, maximum) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

function cleanId(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function finiteNumber(value, name, sourceName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${sourceName}: protection.parameters.${name} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function positiveInteger(value, fallback, name, sourceName, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${sourceName}: protection.parameters.${name} must be an integer from 1 to ${maximum}`);
  }
  return number;
}

function normalizeFarblingParameters(input, sourceName, { floating = false } = {}) {
  const parameters = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const normalized = {
    maximumEdits: positiveInteger(parameters.maximumEdits, 8, "maximumEdits", sourceName, 64)
  };
  if (floating) {
    normalized.epsilon = parameters.epsilon === undefined
      ? 0.0000001
      : finiteNumber(parameters.epsilon, "epsilon", sourceName, 0.000000001, 0.001);
  } else {
    normalized.delta = positiveInteger(parameters.delta, 1, "delta", sourceName, 8);
  }
  return normalized;
}

function normalizeProtection(value, sourceName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceName}: protection must be an object`);
  }
  const strategy = cleanText(value.strategy, 64).toLowerCase();
  if (!SUPPORTED_STRATEGY_SET.has(strategy)) {
    throw new Error(`${sourceName}: unsupported protection strategy "${strategy || "missing"}"`);
  }
  const input = value.parameters && typeof value.parameters === "object" && !Array.isArray(value.parameters)
    ? value.parameters
    : {};
  let parameters;

  switch (strategy) {
    case "canvas-pixel-farbling":
    case "typed-array-farbling":
      parameters = normalizeFarblingParameters(input, sourceName);
      break;
    case "float-array-farbling":
      parameters = normalizeFarblingParameters(input, sourceName, { floating: true });
      break;
    case "bucket-number": {
      const step = finiteNumber(input.step, "step", sourceName, 0.01, 10000);
      const minimum = input.minimum === undefined
        ? -1000000
        : finiteNumber(input.minimum, "minimum", sourceName, -1000000, 1000000);
      const maximum = input.maximum === undefined
        ? 1000000
        : finiteNumber(input.maximum, "maximum", sourceName, -1000000, 1000000);
      if (minimum > maximum) {
        throw new Error(`${sourceName}: protection.parameters.minimum cannot exceed maximum`);
      }
      const rounding = cleanText(input.rounding || "nearest", 16).toLowerCase();
      if (!["nearest", "floor", "ceil"].includes(rounding)) {
        throw new Error(`${sourceName}: protection.parameters.rounding must be nearest, floor, or ceil`);
      }
      parameters = {
        step,
        minimum,
        maximum,
        rounding,
        preserveZero: input.preserveZero === true
      };
      break;
    }
    case "cap-number":
      parameters = {
        maximum: finiteNumber(input.maximum, "maximum", sourceName, -1000000, 1000000)
      };
      break;
    case "replace-number":
      parameters = {
        value: finiteNumber(input.value, "value", sourceName, -1000000, 1000000)
      };
      break;
    case "binary-number":
      parameters = {
        zeroValue: input.zeroValue === undefined
          ? 0
          : finiteNumber(input.zeroValue, "zeroValue", sourceName, -1000000, 1000000),
        nonZeroValue: finiteNumber(input.nonZeroValue, "nonZeroValue", sourceName, -1000000, 1000000)
      };
      break;
    case "replace-string": {
      const replacement = cleanText(input.value, 160);
      if (!replacement) throw new Error(`${sourceName}: protection.parameters.value must be a non-empty string`);
      parameters = { value: replacement };
      break;
    }
    case "text-metrics-farbling":
      parameters = {
        epsilon: input.epsilon === undefined
          ? 0.0001
          : finiteNumber(input.epsilon, "epsilon", sourceName, 0.000001, 0.1)
      };
      break;
    default:
      throw new Error(`${sourceName}: unsupported protection strategy`);
  }

  return { strategy, parameters };
}

function normalizeMatchDetail(value, sourceName) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceName}: match.detail must be an object`);
  }
  const detail = {};
  const entries = Object.entries(value);
  if (entries.length > MAX_MATCH_DETAILS) {
    throw new Error(`${sourceName}: match.detail cannot contain more than ${MAX_MATCH_DETAILS} fields`);
  }
  for (const [rawKey, rawValue] of entries) {
    const key = cleanId(rawKey);
    if (!key) throw new Error(`${sourceName}: match.detail contains an invalid field name`);
    if (typeof rawValue === "string") {
      const text = cleanText(rawValue, 160);
      if (!text) throw new Error(`${sourceName}: match.detail.${key} cannot be empty`);
      detail[key] = text;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      detail[key] = rawValue;
    } else if (typeof rawValue === "boolean") {
      detail[key] = rawValue;
    } else {
      throw new Error(`${sourceName}: match.detail.${key} must be a string, number, or boolean`);
    }
  }
  return detail;
}

function normalizeMatch(value, sourceName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourceName}: match must be an object`);
  }
  const indicatorId = cleanId(value.indicatorId);
  const api = cleanText(value.api, 80);
  const inputActions = Array.isArray(value.actions) ? value.actions : [value.action];
  const actions = [...new Set(inputActions.map((action) => cleanText(action, 80)).filter(Boolean))];
  if (!indicatorId) throw new Error(`${sourceName}: match.indicatorId is required`);
  if (!api) throw new Error(`${sourceName}: match.api is required`);
  if (!actions.length) throw new Error(`${sourceName}: match.action or match.actions is required`);
  if (actions.length > MAX_MATCH_ACTIONS) {
    throw new Error(`${sourceName}: match cannot contain more than ${MAX_MATCH_ACTIONS} actions`);
  }
  return {
    indicatorId,
    api,
    actions,
    detail: normalizeMatchDetail(value.detail, sourceName)
  };
}

export function validateShieldRule(input, sourceName = "Shield rule") {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${sourceName}: each Shield rule must be a JSON object`);
  }
  if (Number(input.schemaVersion) !== 1) {
    throw new Error(`${sourceName}: schemaVersion must be 1`);
  }
  const id = cleanId(input.id);
  const name = cleanText(input.name, 100);
  const description = cleanText(input.description, 400);
  const surface = cleanText(input.surface, 80);
  if (!id) throw new Error(`${sourceName}: id is required`);
  if (!name) throw new Error(`${sourceName}: name is required`);
  if (!description) throw new Error(`${sourceName}: description is required`);
  if (!surface) throw new Error(`${sourceName}: surface is required`);

  return {
    schemaVersion: 1,
    id,
    name,
    category: cleanText(input.category || "Fingerprinting", 60),
    description,
    surface,
    defaultEnabled: input.defaultEnabled !== false,
    match: normalizeMatch(input.match, sourceName),
    protection: normalizeProtection(input.protection, sourceName),
    sourceName: cleanText(sourceName, 180)
  };
}

function candidateRules(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rules)) return parsed.rules;
  if (Array.isArray(parsed?.records)) return parsed.records;
  return [parsed];
}

function parseShieldCandidates(candidates) {
  const rules = [];
  const errors = [];
  const warnings = [];
  const ids = new Set();
  let sourceCount = 0;

  for (const candidate of candidates) {
    if (rules.length >= MAX_MANAGED_SHIELD_RULES) {
      warnings.push(`Only the first ${MAX_MANAGED_SHIELD_RULES} valid Shield rules were loaded.`);
      break;
    }
    sourceCount += 1;
    try {
      const rule = validateShieldRule(candidate.value, candidate.sourceName);
      if (ids.has(rule.id)) throw new Error(`${candidate.sourceName}: duplicate Shield rule id "${rule.id}"`);
      ids.add(rule.id);
      rules.push(rule);
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 500));
    }
  }

  rules.sort((left, right) => left.id.localeCompare(right.id));
  return {
    rules,
    errors,
    warnings,
    sourceCount,
    errorCount: errors.length,
    skippedCount: Math.max(0, sourceCount - rules.length),
    warningCount: warnings.length
  };
}

export function parseManagedShieldDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length) {
    throw new Error("The Shield database did not contain any JSON rule files");
  }
  const candidates = [];
  for (const document of documents.slice(0, MAX_MANAGED_SHIELD_RULES)) {
    const sourceName = cleanText(document?.sourceName || "shield-rule.json", 180);
    const text = typeof document?.text === "string" ? document.text : "";
    if (!text || new TextEncoder().encode(text).byteLength > MAX_SHIELD_DOCUMENT_BYTES) {
      candidates.push({ sourceName, value: null });
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      const values = candidateRules(parsed);
      for (let index = 0; index < values.length; index += 1) {
        candidates.push({
          sourceName: values.length > 1 ? `${sourceName} #${index + 1}` : sourceName,
          value: values[index]
        });
      }
    } catch (error) {
      candidates.push({
        sourceName,
        value: null,
        parseError: String(error?.message || error)
      });
    }
  }

  const parsed = parseShieldCandidates(candidates.map((candidate) => {
    if (candidate.parseError) {
      return {
        sourceName: `${candidate.sourceName}: invalid JSON (${candidate.parseError})`,
        value: null
      };
    }
    return candidate;
  }));
  return parsed;
}

export function parseManagedShieldRecords(records, sourceName = "Bundled Shield database") {
  if (!Array.isArray(records) || !records.length) {
    throw new Error(`${sourceName} has no Shield rule records`);
  }
  return parseShieldCandidates(records.slice(0, MAX_MANAGED_SHIELD_RULES).map((value, index) => ({
    sourceName: `${sourceName} #${index + 1}`,
    value
  })));
}

export function runtimeShieldRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .filter((rule) => rule?.defaultEnabled !== false)
    .slice(0, MAX_MANAGED_SHIELD_RULES)
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      surface: rule.surface,
      description: rule.description,
      match: rule.match,
      protection: rule.protection
    }));
}
