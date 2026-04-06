export const CURRENCY_TO_USD = Object.freeze({
  USD: 1,
  AED: 0.27229,   // pegged ~3.6725/USD — stable, unchanged
  AUD: 0.69090,   // 1.4474 AUD/USD (x-rates Apr 3)
  CAD: 0.71820,   // 1.3924 CAD/USD (x-rates Apr 3)
  CNY: 0.14535,   // 6.8800 CNY/USD (x-rates Apr 3)
  EUR: 1.15355,   // 0.8669 EUR/USD (x-rates Apr 3)
  FJD: 0.44949,   // ~2.225 FJD/USD (Wise/exchange-rates.org Mar–Apr 2026)
  IDR: 0.00005880, // ~17,006 IDR/USD (x-rates Apr 3)
  INR: 0.01077,   // 92.89 INR/USD (x-rates Apr 3)
  JOD: 1.41044,   // pegged ~0.7090 JOD/USD — stable (exchange-rates.org Apr 4)
  JPY: 0.00626,   // ~159.6 JPY/USD (TradingEconomics Apr 3)
  KRW: 0.000662,  // ~1,509.7 KRW/USD (x-rates Apr 3)
  MAD: 0.10638,   // ~9.40 MAD/USD (XE Apr 4)
  MXN: 0.05598,   // 17.863 MXN/USD (x-rates Apr 3)
  MYR: 0.24785,   // 4.0347 MYR/USD (x-rates Apr 3)
  NZD: 0.57121,   // 1.7507 NZD/USD (x-rates Apr 3)
  OMR: 2.59820,   // pegged ~0.3849 OMR/USD (x-rates Apr 3)
  PHP: 0.01657,   // 60.349 PHP/USD (x-rates Apr 3)
  PLN: 0.26965,   // 3.7086 PLN/USD (x-rates Apr 3)
  QAR: 0.27473,   // pegged ~3.64 QAR/USD — stable
  THB: 0.03062,   // 32.663 THB/USD (x-rates Apr 3)
  VND: 0.00003796, // ~26,340 VND/USD (TradingEconomics/XE Apr 3–4)
  XPF: 0.00967,   // ~103.4 XPF/USD (Wise Mar–Apr 2026)
});

export function convertToUsd(amount, currency) {
  const numericAmount = Number.parseFloat(String(amount));
  if (!Number.isFinite(numericAmount)) {
    return "";
  }

  const normalizedCurrency = (typeof currency === "string" ? currency.trim() : "").toUpperCase() || "USD";
  const multiplier = CURRENCY_TO_USD[normalizedCurrency];
  if (!Number.isFinite(multiplier)) {
    throw new Error(`Missing USD transform rule for currency "${normalizedCurrency}"`);
  }

  return numericAmount === 0 ? "0.00" : (numericAmount * multiplier).toFixed(2);
}
