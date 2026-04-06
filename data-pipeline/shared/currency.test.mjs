import test from "node:test";
import assert from "node:assert/strict";
import { convertToUsd } from "./currency.mjs";

test("convertToUsd returns '0.00' for zero input", () => {
  assert.strictEqual(convertToUsd("0", "USD"), "0.00");
});

test("convertToUsd converts USD to USD unchanged", () => {
  assert.strictEqual(convertToUsd("100", "USD"), "100.00");
});

test("convertToUsd converts AED to USD using fixed peg", () => {
  // 100 AED × 0.27229 = 27.229 → "27.23"
  assert.strictEqual(convertToUsd("100", "AED"), "27.23");
});

test("convertToUsd accepts numeric string with decimals", () => {
  // 125.25 AED × 0.27229 ≈ 34.10 → must be decimal string
  const result = convertToUsd("125.25", "AED");
  assert.match(result, /^\d+\.\d{2}$/u);
});

test("convertToUsd returns empty string for non-numeric input", () => {
  assert.strictEqual(convertToUsd("not-a-number", "USD"), "");
});

test("convertToUsd is case-insensitive for currency code", () => {
  assert.strictEqual(convertToUsd("100", "usd"), "100.00");
  assert.strictEqual(convertToUsd("100", "Usd"), "100.00");
});

test("convertToUsd throws for unknown currency", () => {
  assert.throws(
    () => convertToUsd("100", "XYZ"),
    /Missing USD transform rule for currency "XYZ"/u
  );
});
