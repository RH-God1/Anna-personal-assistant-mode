const SUPPORTED = ["en", "zh-CN"];

export function normalizeLocale(input) {
  const value = String(input || "").toLowerCase();
  if (value === "zh" || value.startsWith("zh-")) {
    return "zh-CN";
  }
  return "en";
}

export function formatFocusedMinutes(seconds, locale) {
  const minutes = Math.round((Math.max(0, Number(seconds) || 0) / 60) * 10) / 10;
  return new Intl.NumberFormat(normalizeLocale(locale), {
    maximumFractionDigits: 1
  }).format(minutes);
}

export function formatTime(epochSeconds, locale) {
  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(Number(epochSeconds || 0) * 1000));
}

export function createTranslator(catalog, locale) {
  const normalized = normalizeLocale(locale);
  const pluralRules = new Intl.PluralRules(normalized);

  return (key, values = {}) => {
    let text = catalog[key] || key;
    const plural = text.match(/^\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}$/);
    if (plural) {
      const count = Number(values[plural[1]] || 0);
      const branch = pluralRules.select(count) === "one" ? plural[2] : plural[3];
      return branch.replace("#", new Intl.NumberFormat(normalized).format(count));
    }
    return text.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ""));
  };
}

export async function loadLocale(preferred) {
  const locale = SUPPORTED.includes(preferred) ? preferred : normalizeLocale(preferred);
  const response = await fetch(`./locales/${locale}.json`);
  if (!response.ok) {
    throw new Error(`Cannot load locale ${locale}`);
  }
  return { locale, catalog: await response.json() };
}
