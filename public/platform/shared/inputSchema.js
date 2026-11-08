/** @typedef {{min: number, max: number, integer?: boolean}} NumericInputRange */
/**
 * Game adapters supply the supported keys; each number needs an explicit range.
 * @template {string} InputKey
 * @typedef {Partial<Record<InputKey, NumericInputRange>>} NumericInputConfiguration
 */

/** @param {unknown} inputRecord @returns {inputRecord is Record<string, unknown>} */
function isInputRecord(inputRecord) {
  return inputRecord !== null && typeof inputRecord === "object" && !Array.isArray(inputRecord);
}

/**
 * Validate a numeric command value without coercion or clamping.
 * @param {unknown} inputValue
 * @param {NumericInputRange} inputRange
 * @returns {inputValue is number}
 */
export function isValidNumericInputValue(inputValue, inputRange) {
  return typeof inputValue === "number" && Number.isFinite(inputValue) &&
    inputValue >= inputRange.min && inputValue <= inputRange.max &&
    (!inputRange.integer || Number.isInteger(inputValue));
}

/**
 * Validate and copy a game's neutral input template and numeric ranges once.
 * Edge inputs must name supported boolean fields. The copies are SDK-owned.
 * @template {string} InputKey
 * @param {Record<InputKey, boolean | number>} inputTemplate
 * @param {NumericInputConfiguration<InputKey>} [numericInputs]
 * @param {ReadonlyArray<InputKey>} [edgeKeys]
 * @returns {{inputTemplate: Record<InputKey, boolean | number>, numericInputs: NumericInputConfiguration<InputKey>}}
 * @throws {TypeError} For unsupported shapes, ranges, defaults or edge fields.
 */
export function createInputSchema(inputTemplate, numericInputs = {}, edgeKeys = []) {
  if (!isInputRecord(inputTemplate) || !isInputRecord(numericInputs) || !Array.isArray(edgeKeys)) {
    throw new TypeError("Game input schema requires an input template, numeric ranges and edge key array.");
  }

  for (const [inputKey, inputRange] of Object.entries(numericInputs)) {
    if (!Object.hasOwn(inputTemplate, inputKey) || typeof inputTemplate[inputKey] !== "number" ||
        !isInputRecord(inputRange) || !Number.isFinite(inputRange.min) || !Number.isFinite(inputRange.max) ||
        inputRange.min > inputRange.max ||
        (inputRange.integer !== undefined && typeof inputRange.integer !== "boolean") ||
        Object.keys(inputRange).some((rangeKey) => !["min", "max", "integer"].includes(rangeKey))) {
      throw new TypeError(`Invalid numeric input range for ${inputKey}.`);
    }
  }

  for (const [inputKey, inputValue] of Object.entries(inputTemplate)) {
    const inputRange = Object.hasOwn(numericInputs, inputKey) ? numericInputs[inputKey] : undefined;
    if (inputRange ? !isValidNumericInputValue(inputValue, inputRange) : typeof inputValue !== "boolean") {
      throw new TypeError(`Invalid game input default or missing numeric range for ${inputKey}.`);
    }
  }
  if (edgeKeys.some((inputKey) => !Object.hasOwn(inputTemplate, inputKey) || typeof inputTemplate[inputKey] !== "boolean")) {
    throw new TypeError("Game input edge keys must name supported boolean inputs.");
  }

  return {
    inputTemplate: { ...inputTemplate },
    numericInputs: Object.fromEntries(Object.entries(numericInputs).map(([inputKey, inputRange]) => [inputKey, { ...inputRange }])),
  };
}

/**
 * Check a complete input state against a validated game schema. Missing and
 * unknown keys, coerced booleans and nonfinite/out-of-range numbers are rejected.
 * @template {string} InputKey
 * @param {unknown} inputState
 * @param {Record<InputKey, boolean | number>} inputTemplate
 * @param {NumericInputConfiguration<InputKey>} [numericInputs]
 * @returns {inputState is Record<InputKey, boolean | number>}
 */
export function isValidGameInputState(inputState, inputTemplate, numericInputs = {}) {
  if (!isInputRecord(inputState) || Object.keys(inputState).length !== Object.keys(inputTemplate).length) {
    return false;
  }

  return Object.keys(inputTemplate).every((inputKey) => {
    if (!Object.hasOwn(inputState, inputKey)) {
      return false;
    }
    const inputRange = Object.hasOwn(numericInputs, inputKey) ? numericInputs[inputKey] : undefined;
    return inputRange ? isValidNumericInputValue(inputState[inputKey], inputRange) : typeof inputState[inputKey] === "boolean";
  });
}
